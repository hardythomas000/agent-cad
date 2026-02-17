---
title: "feat: SDF → Mesh Export via Marching Cubes + STL"
type: feat
date: 2026-02-17
phase: 4
---

# Phase 4: SDF → Mesh Export via Marching Cubes + STL

## Overview

Add marching cubes mesh extraction and STL export to the SDF kernel, plus 3 new MCP tools for agent-driven mesh workflows. This is the first **conversion boundary** — turning the mathematical SDF into physical geometry an LLM agent can export for manufacturing or visualization.

## Problem Statement

The SDF kernel can create, combine, and query shapes — but has no way to output geometry. An agent can `create_box` → `boolean_subtract` → `evaluate_point`, but can't produce a file a slicer, viewer, or CNC machine can consume. Phase 4 closes this gap.

## Proposed Solution

Pure TypeScript marching cubes implementation in `sdf-kernel` (zero new dependencies), plus binary STL writer. Three new MCP tools in `mcp-server`. No external mesh library — the algorithm is ~200 lines beyond lookup tables, and we get full control over memory, normals, and the streaming slab approach.

## Technical Approach

### Architecture

```
SDF shape (evaluate + bounds)
    │
    ▼
┌──────────────────────────┐
│  marchingCubes()         │  sdf-kernel/src/marching-cubes.ts
│  - Uniform grid          │
│  - Slab streaming (2     │
│    Z-slices at a time)   │
│  - SDF gradient normals  │
│  - Edge interpolation    │
└──────────┬───────────────┘
           │ TriangleMesh
           ▼
┌──────────────────────────┐
│  exportSTL()             │  sdf-kernel/src/stl.ts
│  - Binary format         │
│  - Face normals from     │
│    cross product          │
│  - Returns ArrayBuffer   │
└──────────────────────────┘
           │
           ▼
  MCP tool writes to filesystem,
  returns path + metadata
```

### New Files

| File | Package | Lines (est.) | Purpose |
|------|---------|-------------|---------|
| `src/marching-cubes.ts` | sdf-kernel | ~250 | Algorithm + lookup tables |
| `src/stl.ts` | sdf-kernel | ~60 | Binary STL writer |
| `src/mesh.ts` | sdf-kernel | ~20 | TriangleMesh type definition |
| `test/marching-cubes.test.ts` | sdf-kernel | ~100 | Mesh extraction tests |
| `test/stl.test.ts` | sdf-kernel | ~40 | STL format tests |

### Modified Files

| File | Package | Change |
|------|---------|--------|
| `src/index.ts` | sdf-kernel | Export `marchingCubes`, `exportSTL`, `TriangleMesh` |
| `src/tools.ts` | mcp-server | Add 3 new tools |

### No New Dependencies

The sdf-kernel stays zero-dependency. Marching cubes is pure math + lookup tables. STL is just `DataView` writes to an `ArrayBuffer`. Both use only TypeScript built-ins.

---

## Implementation Phases

### Phase 4A: Types & Mesh Data Structure

**File: `sdf-kernel/src/mesh.ts`**

```typescript
import type { Vec3, BoundingBox } from './vec3.js';

export interface TriangleMesh {
  positions: Float32Array;   // Flat: [x0,y0,z0, x1,y1,z1, ...] — 3 floats per vertex
  normals: Float32Array;     // Flat: [nx0,ny0,nz0, ...] — per-vertex SDF gradient normals
  indices: Uint32Array;      // Flat: [i0,i1,i2, ...] — 3 indices per triangle
  vertexCount: number;
  triangleCount: number;
  bounds: BoundingBox;
}
```

**Why flat typed arrays:**
- Direct upload to WebGL/WebGPU buffers (Phase 1 viewer later)
- Efficient binary STL writing via DataView
- ~2x less memory than `Vec3[][]` (no object overhead)
- Standard interchange format (glTF, Three.js all use flat Float32Arrays)

**Acceptance criteria:**
- [ ] `TriangleMesh` interface defined
- [ ] Exported from `sdf-kernel/src/index.ts`

---

### Phase 4B: Marching Cubes Algorithm

**File: `sdf-kernel/src/marching-cubes.ts`**

**Function signature:**
```typescript
export function marchingCubes(
  sdf: SDF,
  resolution: number,       // Voxel size in mm (e.g., 1.0)
  bounds?: BoundingBox,      // Optional override; defaults to sdf.bounds()
  padding?: number,          // Extra padding around bounds (default: resolution * 2)
): TriangleMesh
```

**Algorithm (uniform grid, slab streaming):**

1. **Compute grid bounds**: Use `sdf.bounds()` (or override), add padding so marching cubes doesn't clip the surface.
2. **Compute grid dimensions**: `nx = ceil((max.x - min.x) / resolution)`, etc.
3. **Allocate slab buffers**: Two Z-slices of SDF values (`Float64Array`, `nx * ny` each). This keeps memory at O(nx * ny) instead of O(nx * ny * nz).
4. **Evaluate first Z-slice**: Sample SDF at all (x, y, z_min) grid points.
5. **For each Z-slab** (z = 0 to nz-1):
   a. Evaluate the next Z-slice.
   b. For each cube in the slab, build 8-corner values from the two slices.
   c. Compute `cubeIndex` from sign bits.
   d. Look up `edgeTable[cubeIndex]` — skip if 0 (no surface).
   e. Interpolate vertex positions on intersected edges.
   f. Look up `triTable[cubeIndex]` — emit triangles.
   g. Swap slabs (current becomes previous).
6. **Compute normals**: For each unique vertex, compute SDF gradient via central differences (6 evals per vertex) or tetrahedron technique (4 evals). Use eps = resolution / 2.
7. **Build output**: Pack into `TriangleMesh` typed arrays.

**Vertex deduplication**: Use an edge-based hash map. Each edge is uniquely identified by the grid coordinates of its two endpoints. Map `edgeKey → vertexIndex` to avoid duplicate vertices at shared edges between adjacent cubes. This typically reduces vertex count by ~3-4x.

**Lookup tables**: The standard 256-entry `edgeTable` and `triTable` from Paul Bourke / Cory Gene Bloyd. Include as const arrays in the source file (they're small — ~5KB of code).

**Acceptance criteria:**
- [ ] `marchingCubes()` function implemented
- [ ] Slab streaming (2 Z-slices) — not full grid allocation
- [ ] Edge interpolation for smooth vertices
- [ ] Vertex deduplication via edge hashing
- [ ] SDF gradient normals per vertex
- [ ] Lookup tables included inline
- [ ] Exported from `sdf-kernel/src/index.ts`

---

### Phase 4C: Binary STL Export

**File: `sdf-kernel/src/stl.ts`**

```typescript
export function exportSTL(mesh: TriangleMesh, header?: string): ArrayBuffer
```

**Binary STL format (50 bytes per triangle):**
```
[80 bytes]  header
[4 bytes]   uint32 triangle count (little-endian)
Per triangle:
  [12 bytes] float32 x3 — face normal (cross product of edges)
  [12 bytes] float32 x3 — vertex 1
  [12 bytes] float32 x3 — vertex 2
  [12 bytes] float32 x3 — vertex 3
  [2 bytes]  uint16 — attribute (0)
```

**Face normals**: Compute from cross product of triangle edges (standard for STL). Do NOT use the per-vertex SDF normals — STL slicers expect per-facet normals.

**Acceptance criteria:**
- [ ] `exportSTL()` produces valid binary STL
- [ ] Header includes "agent-cad" identifier
- [ ] Face normals computed via cross product
- [ ] Output parseable by any STL viewer/slicer
- [ ] Exported from `sdf-kernel/src/index.ts`

---

### Phase 4D: Tests

**File: `sdf-kernel/test/marching-cubes.test.ts`**

Tests following existing Vitest + `near()` helper pattern:

```typescript
describe('marchingCubes', () => {
  // Sphere tests
  it('meshes a sphere with correct triangle count range', ...)
  it('all vertices are near the sphere surface (distance < resolution)', ...)
  it('mesh bounds match sphere radius', ...)
  it('vertex normals point outward', ...)

  // Box tests
  it('meshes a box with ~12 triangles at low resolution', ...)
  it('box mesh bounds match box dimensions', ...)

  // Boolean tests
  it('meshes a sphere-minus-cylinder (hollow tube)', ...)

  // Edge cases
  it('returns empty mesh for plane (infinite shape, bounded grid)', ...)
  it('handles resolution parameter (finer = more triangles)', ...)
  it('custom bounds override works', ...)
});
```

**File: `sdf-kernel/test/stl.test.ts`**

```typescript
describe('exportSTL', () => {
  it('produces correct binary header (80 bytes)', ...)
  it('triangle count matches mesh', ...)
  it('total size = 84 + triangleCount * 50', ...)
  it('face normals are unit vectors', ...)
  it('round-trip: mesh → STL → parse → same triangles', ...)
});
```

**Acceptance criteria:**
- [ ] ≥12 tests for marching cubes
- [ ] ≥5 tests for STL export
- [ ] All existing 82 tests still passing
- [ ] Float comparisons use `near()` helper

---

### Phase 4E: MCP Tools (3 new tools → 24 total)

**File: `mcp-server/src/tools.ts`** — add to `registerTools()`:

#### Tool: `mesh_shape`
```
Convert an SDF shape to a triangle mesh via marching cubes.
Params:
  shape: string       — ID of shape to mesh
  resolution: number  — Voxel size in mm (default: 1.0, smaller = finer)
  name?: string       — Optional name for the mesh result
Returns:
  { shape_id, type: "mesh", readback, mesh_info: { vertexCount, triangleCount, memoryBytes } }
```

#### Tool: `export_stl`
```
Export a meshed shape to STL file. Meshes the shape first if not already meshed.
Params:
  shape: string        — ID of shape (will auto-mesh if SDF, not mesh)
  resolution?: number  — Voxel size if auto-meshing (default: 1.0)
  path?: string        — Output path (default: /tmp/agent-cad-{id}.stl)
Returns:
  { file_path, file_size_bytes, triangle_count, bounds }
```

The tool writes the STL to disk and returns the path + metadata. This follows the MCP best practice for large binary results (filesystem + resource_link, not inline base64).

#### Tool: `mesh_info`
```
Get detailed information about a meshed shape.
Params:
  shape: string — ID of shape
Returns:
  { shape_id, vertex_count, triangle_count, memory_bytes, bounds, normals_type }
```

**Registry changes**: The registry currently stores `ShapeEntry { id, shape: SDF, type }`. For mesh results, we need to also store the `TriangleMesh`. Options:

- **Option A (recommended)**: Add optional `mesh?: TriangleMesh` field to `ShapeEntry`. When a shape is meshed, the mesh is cached on the entry. `export_stl` checks for cached mesh first.
- **Option B**: Separate mesh registry. More complexity, less value.

**Acceptance criteria:**
- [ ] 3 new MCP tools registered
- [ ] `mesh_shape` returns structured readback with mesh stats
- [ ] `export_stl` writes valid binary STL to disk, returns path
- [ ] `export_stl` auto-meshes SDF shapes that haven't been meshed yet
- [ ] Mesh caching on registry entries (no redundant re-meshing)
- [ ] All 21 existing tools unaffected

---

## Performance Budget

| Shape | Resolution | Grid | Eval calls | Est. time | Triangles |
|-------|-----------|------|-----------|-----------|-----------|
| Sphere r=50 | 2mm | 50³ | 125K | ~50ms | ~5K |
| Sphere r=50 | 1mm | 100³ | 1M | ~400ms | ~20K |
| Sphere r=50 | 0.5mm | 200³ | 8M | ~3s | ~80K |
| Complex boolean | 1mm | 150³ | 3.4M | ~2s | ~50K |

The bottleneck is SDF evaluations. Each cube corner is evaluated once (shared via slab streaming). Per-vertex normals add 4-6 evals each. Acceptable for agent workflows where the LLM waits for a response anyway.

## Risk Analysis

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Lookup tables have a typo | Low | Use widely-validated Bourke/Bloyd tables. Test against known sphere mesh. |
| Memory pressure on phone (Termux) | Medium | Slab streaming limits to 2 Z-slices. Default resolution=1mm keeps grids small. |
| Vertex deduplication hash collisions | Low | Use string key from grid coordinates (exact, no floating point). |
| STL files unreadable by slicers | Low | Test with standard header format. Binary STL is dead simple. |
| Normals inverted (inside-out mesh) | Medium | Test: all normals point away from shape center. Fix: check winding order. |

## Success Criteria

1. `marchingCubes(sphere(10), 1)` produces a watertight mesh with vertices within 1mm of the true sphere surface
2. `exportSTL()` output loads correctly in any STL viewer
3. Full agent workflow works: `create_box` → `boolean_subtract` → `mesh_shape` → `export_stl` → file on disk
4. All tests pass (82 existing + ~17 new)
5. No new npm dependencies in sdf-kernel

## References

- [Paul Bourke — Polygonising a Scalar Field](https://paulbourke.net/geometry/polygonise/) — canonical marching cubes reference
- [Inigo Quilez — Normals for an SDF](https://iquilezles.org/articles/normalsSDF/) — gradient normal computation
- [MCP Tools Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — resource_link for binary results
- [Marching Cubes Lookup Tables (Bloyd/Bourke)](https://gist.github.com/dwilliamson/c041e3454a713e58baf6e4f8e5fffecd)
- VISION.md Design Principle 2: "The Kernel Talks Back"
- VISION.md Design Principle 6: "SDF-First"
