---
title: "feat: Multi-level contour roughing and dimension readout"
type: feat
date: 2026-02-20
reviewed: true
---

# Multi-Level Contour Roughing + Dimension Readout

## Overview

Two features that deliver immediate CAM and viewer value with minimal risk. No new infrastructure, no new abstractions — just extending proven patterns.

1. **Multi-level contour roughing** — Z-level waterline roughing by looping `generateContourToolpath()` at incremental depths
2. **Dimension readout** — enhance hover status bar to show hole diameter, wall thickness, and chamfer/fillet size

**Ship as one deliverable.** Phase 1 is kernel + MCP. Phase 2 is viewer-only. No dependency between them — can be implemented in either order or in parallel.

### Review Findings Applied

Three-reviewer parallel review (DHH, Kieran-TS, Simplicity). Key changes from original 5-phase plan:

| Original | Revised | Reason |
|----------|---------|--------|
| 5 phases (contour, registry, readout, sliders, constraints) | 2 phases (contour + readout) | Phases 4-5 cut: sliders fight code-first thesis, constraints premature (LLMs compute coords trivially) |
| Feature registry (Phase 2) as foundation | Cut entirely | YAGNI — dimension readout works from topology alone. Chamfer/fillet size via `EdgeBreak.faces()` (5 lines). Build registry when interactive editing proves necessary. |
| `MultiLevelContourParams` duplicates `ContourToolpathParams` fields | Extract `BaseContourParams` shared interface | Kieran: eliminates field drift between single-level and multi-level |
| Overload `generate_contour_toolpath` MCP tool with mutual exclusion | Separate `generate_multilevel_contour` MCP tool | Simplicity: two simple tools > one complex tool with mode switching |
| `query_dimension` MCP tool | Cut | YAGNI — LLM already has `query_face` with radius/origin, can compute derived dimensions |
| Wall thickness returns first antiparallel match | Returns closest antiparallel pair | Kieran: first-found is wrong for shapes with multiple parallel face pairs |
| No tests for wall thickness | Unit tests added | DHH: algorithmic logic should be tested regardless of which package it lives in |
| Chamfer/fillet size from feature registry | From `EdgeBreak.faces()` — add `size` field to face descriptor | Simplicity: 5 lines in sdf.ts, no registry needed |

---

## Phase 1: Multi-Level Contour Roughing

**Effort:** ~1 session | **Risk:** Low | **Dependencies:** None

### Problem

The contour toolpath does one Z level per call. Every CNC roughing operation needs Z-level waterline roughing — stack contours at incremental depths to remove bulk material. Currently the user must loop manually in the DSL editor. This should be a single function call.

### Approach

Create `generateMultiLevelContour()` that loops from `z_top` down to `z_bottom` in `step_down` increments, calling the existing contour extraction logic at each level. The `leave_stock` parameter expands the SDF offset beyond tool radius so the contour leaves material for a finish pass.

All points go into one unified `ToolpathPoint[]` array — the existing G-code emitter and viewer renderer work without changes.

### Types

Extract shared fields into a base interface to eliminate duplication between single-level and multi-level:

```typescript
// packages/sdf-kernel/src/toolpath.ts

interface BaseContourParams {
  direction?: 'climb' | 'conventional';
  point_spacing?: number;     // mm along contour (default: 0.5)
  feed_rate: number;
  plunge_rate?: number;
  rpm: number;
  safe_z: number;
  resolution?: number;        // marching squares cell size (default: 1.0)
}

// Existing — now extends base:
export interface ContourToolpathParams extends BaseContourParams {
  z_level: number;
}

// New:
export interface MultiLevelContourParams extends BaseContourParams {
  z_top: number;              // CNC Z start (highest level)
  z_bottom: number;           // CNC Z end (lowest level)
  step_down: number;          // Depth per level (positive, mm)
  leave_stock?: number;       // Radial material allowance (default: 0)
}
```

### Algorithm

```
1. Validate: z_top > z_bottom, step_down > 0, safe_z > z_top
2. Compute tool offset: R_effective = tool.radius + (leave_stock ?? 0)
3. Create offset SDF: Round(shape, R_effective)
4. For z = z_top, z - step_down, ..., z_bottom:
   a. Run extractContours() at y = z on the offset SDF
   b. Resample + order loops (existing logic from generateContourToolpath)
   c. For each loop: rapid to safe_z → rapid to loop start → plunge → cut → retract
   d. Append to unified points array
5. Return single ContourToolpathResult with all points + aggregate stats
```

**Retract strategy:** Full retract to `safe_z` between every level change. Safest approach, standard CNC practice for roughing.

**Leave stock:** Radial only (XY material allowance). The offset SDF becomes `Round(shape, R + leave_stock)`. Z-level stock allowance is handled by adjusting `z_bottom`.

**Empty levels:** Some Z levels may have no contour (air above the part, or the shape doesn't extend to that Z). Skip silently — no error, no empty rapid-retract cycle.

**Last level:** If `step_down` doesn't evenly divide `z_top - z_bottom`, the last level is at `z_bottom` exactly (not overshoot).

### Internal Refactor

The existing `generateContourToolpath()` has the contour extraction, resampling, and point generation inline. To reuse it from `generateMultiLevelContour()` without duplicating ~60 lines, extract the per-level logic into a private helper:

```typescript
/** Extract contour loops at a single Y level and append toolpath points. */
function appendContourLevel(
  offsetShape: SDF,
  sdfY: number,
  safeY: number,
  climb: boolean,
  spacing: number,
  cellSize: number,
  gridBounds: { xMin: number; xMax: number; zMin: number; zMax: number },
  points: ToolpathPoint[],
): number; // returns loop count for this level
```

Both `generateContourToolpath()` and `generateMultiLevelContour()` call this helper. No external API change to single-level — just an internal restructure.

### Function Signature

```typescript
export function generateMultiLevelContour(
  shape: SDF,
  tool: ToolDefinition,
  params: MultiLevelContourParams,
): Omit<ContourToolpathResult, 'id'>;
```

Returns a `ContourToolpathResult` with `loop_count` = total loops across all levels. The `bounds.y` range spans `[z_bottom, z_top]`.

### Viewer DSL

```typescript
// kernel-bridge.ts — add showMultiLevelContour()

showMultiLevelContour(shape, tool, {
  z_top: 25, z_bottom: 0, step_down: 2,
  leave_stock: 0.3,
  feed_rate: 2000, rpm: 8000, safe_z: 30
})
```

A separate DSL function, not an overload of `showContour()`. The existing `showContour()` remains unchanged (takes `z_level`). No runtime dispatch, no mutual exclusion validation — two distinct functions with distinct types.

### MCP Tool

Add a new `generate_multilevel_contour` MCP tool (separate from `generate_contour_toolpath`):

```
generate_multilevel_contour(shape, tool, z_top, z_bottom, step_down,
                             leave_stock?, direction?, point_spacing?,
                             feed_rate, plunge_rate?, rpm, safe_z,
                             resolution?, name?)
```

Two simple tools > one complex tool with mode switching. The LLM picks the right tool based on whether it wants one level or many.

### Files to Modify

| File | Changes |
|------|---------|
| `packages/sdf-kernel/src/toolpath.ts` | Extract `BaseContourParams`, refactor `generateContourToolpath()` to use `appendContourLevel()` helper, add `MultiLevelContourParams` + `generateMultiLevelContour()` (~100 lines net new) |
| `packages/sdf-kernel/src/index.ts` | Export new types + function |
| `packages/sdf-kernel/test/toolpath.test.ts` | ~8 new tests |
| `packages/mcp-server/src/tools.ts` | Add `generate_multilevel_contour` tool (~50 lines) |
| `packages/mcp-server/src/registry.ts` | Support `'multilevel_contour'` toolpath type in `createToolpath` |
| `packages/viewer/src/kernel-bridge.ts` | Add `showMultiLevelContour()` DSL function (~20 lines) |
| `CLAUDE.md` | Update CAM section, tool count |

### Tests (~8)

- Box with `step_down: 5` from `z_top: 25` to `z_bottom: 0` → 6 levels, each with rectangular contour
- Cylinder → circular contours at each level
- `leave_stock: 0.5` → contour offset wider than just tool radius
- `z_top === z_bottom` → single level (degenerate case, still works)
- `step_down` not evenly dividing range → last level at `z_bottom` exactly
- Empty levels (shape doesn't extend to z_top) → skipped silently, no crash
- G-code emission for multi-level → valid Fanuc output with retract-rapids between levels
- Stats: `loop_count` aggregates across all levels, `estimated_time_min` is total

### Performance

Multi-level is N x single-level. For `step_down: 0.5` on a 50mm range (100 levels), this could be slow. **Mitigation:** document that fine step-down with fine resolution may take several seconds. The per-level cost is already gated by the existing contour benchmark. No new benchmark gate needed.

---

## Phase 2: Dimension Readout

**Effort:** ~1 session | **Risk:** Low | **Dependencies:** None (uses existing topology, no registry)

### Problem

Hover currently shows face name, kind, and `R=5.0` for cylindrical faces or `[x, y, z]` origin for planar. Manufacturing requires:
- **Hole diameter** — `D=10.0mm` not `R=5.0` (machinists think in diameter)
- **Wall thickness** — distance between parallel faces (critical for checking minimum wall)
- **Chamfer/fillet size** — how big is the edge break

All of this data is already available from topology — no feature registry needed.

### Approach

Enhance `showFaceInfo()` in `main.ts`. Minimal changes:

1. **Diameter**: Change `R=` to `D=` for cylindrical faces (1-line change)
2. **Wall thickness**: Find antiparallel face pair, compute origin distance (~30 lines)
3. **Chamfer/fillet size**: Add `size` field to `EdgeBreak.faces()` return value (~5 lines in sdf.ts)

### Diameter Readout (1 line)

Current ([main.ts:425-427](packages/viewer/src/main.ts#L425-L427)):
```typescript
if (info.radius != null) {
  text += ` R=${info.radius.toFixed(1)}`;
}
```

Change to:
```typescript
if (info.radius != null) {
  text += ` D=${(info.radius * 2).toFixed(1)}mm`;
}
```

### Wall Thickness

Compute distance between antiparallel planar face pairs. Precomputed once per mesh in `meshToResult()` and cached on `FaceMapData` (not recomputed per hover event — Kieran's performance note).

```typescript
// Precomputed during meshToResult(), stored on FaceMapData
wallThickness: Map<string, number>;  // faceName → thickness to closest antiparallel face
```

Algorithm:
```typescript
function computeWallThicknesses(allFaces: FaceDescriptor[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const face of allFaces) {
    if (face.kind !== 'planar' || !face.origin) continue;
    let minDist = Infinity;
    for (const other of allFaces) {
      if (other.name === face.name || other.kind !== 'planar' || !other.origin) continue;
      const dot = face.normal[0] * other.normal[0] +
                  face.normal[1] * other.normal[1] +
                  face.normal[2] * other.normal[2];
      if (dot > -0.99) continue; // Not antiparallel
      const dx = other.origin[0] - face.origin[0];
      const dy = other.origin[1] - face.origin[1];
      const dz = other.origin[2] - face.origin[2];
      const dist = Math.abs(dx * face.normal[0] + dy * face.normal[1] + dz * face.normal[2]);
      if (dist < minDist) minDist = dist;
    }
    if (minDist < Infinity) result.set(face.name, minDist);
  }
  return result;
}
```

**Uses closest pair** (not first-found) to handle shapes with multiple parallel face pairs correctly.

### Chamfer/Fillet Size via EdgeBreak.faces()

Instead of a feature registry, add the `size` to the face descriptor returned by `EdgeBreak.faces()`. This is 5 lines in `sdf.ts`:

Currently `EdgeBreak.faces()` returns the break face with `kind: 'freeform'`. Add `edgeBreakSize` to the descriptor:

```typescript
// packages/sdf-kernel/src/sdf.ts — EdgeBreak.faces()
// Add to the break face descriptor:
{
  name: `${this.featureName}.face`,
  normal: [0, 0, 0], // freeform — no single normal
  kind: 'freeform' as const,
  edgeBreakSize: this.size,      // NEW
  edgeBreakMode: this.mode,      // NEW: 'chamfer' | 'fillet'
}
```

Extend `FaceDescriptor` type to include optional `edgeBreakSize?: number` and `edgeBreakMode?: 'chamfer' | 'fillet'`.

Then in the viewer's `showFaceInfo()`:
```typescript
if (info.edgeBreakSize != null) {
  text += info.edgeBreakMode === 'fillet'
    ? ` R=${info.edgeBreakSize.toFixed(1)}mm`
    : ` size=${info.edgeBreakSize.toFixed(1)}mm`;
}
```

### FaceMapData Extension

```typescript
export interface FaceMapData {
  faceIds: Int32Array;
  faceNames: string[];
  faceInfo: Map<string, {
    kind: string;
    origin?: [number, number, number];
    radius?: number;
    edgeBreakSize?: number;       // NEW
    edgeBreakMode?: string;       // NEW
  }>;
  wallThickness: Map<string, number>;  // NEW: precomputed per-face
}
```

Populated during `meshToResult()`:
- `edgeBreakSize` / `edgeBreakMode` from the face descriptor (populated by `EdgeBreak.faces()`)
- `wallThickness` from `computeWallThicknesses(allFaces)` — called once per mesh

### Enhanced showFaceInfo()

```typescript
function showFaceInfo(faceId: number, faceMap: FaceMapData): void {
  const faceName = faceMap.faceNames[faceId];
  if (!faceName || faceName === '__unknown__') { statusFace.textContent = ''; return; }

  const info = faceMap.faceInfo.get(faceName);
  let text = faceName;

  if (info) {
    text += ` (${info.kind})`;

    // Hole diameter
    if (info.radius != null) {
      text += ` D=${(info.radius * 2).toFixed(1)}mm`;
    }
    // Chamfer/fillet size
    else if (info.edgeBreakSize != null) {
      text += info.edgeBreakMode === 'fillet'
        ? ` R=${info.edgeBreakSize.toFixed(1)}mm`
        : ` size=${info.edgeBreakSize.toFixed(1)}mm`;
    }
    // Wall thickness (planar faces with antiparallel pair)
    else if (info.kind === 'planar') {
      const wall = faceMap.wallThickness.get(faceName);
      if (wall != null) {
        text += ` wall=${wall.toFixed(1)}mm`;
      } else if (info.origin) {
        text += ` [${info.origin[0].toFixed(0)}, ${info.origin[1].toFixed(0)}, ${info.origin[2].toFixed(0)}]`;
      }
    }
  }

  statusFace.textContent = text;
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `packages/sdf-kernel/src/topology.ts` | Add `edgeBreakSize?: number`, `edgeBreakMode?: 'chamfer' \| 'fillet'` to `FaceDescriptor` (~3 lines) |
| `packages/sdf-kernel/src/sdf.ts` | `EdgeBreak.faces()` returns `edgeBreakSize` and `edgeBreakMode` (~5 lines) |
| `packages/viewer/src/main.ts` | Enhance `showFaceInfo()` (~25 lines net), change `R=` to `D=` (1 line) |
| `packages/viewer/src/kernel-bridge.ts` | Extend `FaceMapData` with `wallThickness` map + `edgeBreakSize`/`edgeBreakMode` in `faceInfo`. Add `computeWallThicknesses()`, call in `meshToResult()` (~40 lines) |
| `CLAUDE.md` | Update viewer feature list |

### Tests (~4)

- `computeWallThicknesses()` on a box → all 6 faces have correct wall thickness
- Box with a pocket → pocket floor shows pocket thickness, not full box height
- Multiple antiparallel pairs → returns closest distance
- Shape with no antiparallel pairs (e.g., cylinder) → empty map

### Constraints

- **Hover only** — no click interaction in this phase
- **Wall thickness for planar faces only** — cylindrical faces show diameter instead
- **Chamfer/fillet size from EdgeBreak only** — `round_edges` (global) does not report size per face
- **No MCP tool** — dimension data is viewer-only. LLM already has `query_face` with radius/origin.

---

## Acceptance Criteria

### Phase 1: Multi-Level Contour
- [x] `generateMultiLevelContour(box, tool, { z_top: 25, z_bottom: 0, step_down: 5, ... })` produces 6 levels of contour
- [x] `leave_stock: 0.3` widens contour offset by 0.3mm beyond tool radius
- [x] Empty levels (air) are skipped silently
- [x] G-code output has proper retract-rapids between levels
- [x] DSL: `showMultiLevelContour(shape, tool, { ... })` renders multi-level contour in viewer
- [x] MCP: `generate_multilevel_contour` tool works end-to-end
- [x] Stats report aggregate `loop_count` and `estimated_time_min` across all levels
- [x] Existing `generateContourToolpath()` still works unchanged (no regression)
- [x] Tests pass (~8 new → 11 new, 390 total)

### Phase 2: Dimension Readout
- [x] Hover over hole barrel → `hole_1.barrel (cylindrical) D=10.0mm`
- [x] Hover over box face with antiparallel pair → `right (planar) wall=100.0mm`
- [x] Hover over chamfer face → `chamfer_1.face (freeform) size=3.0mm`
- [x] Hover over fillet face → `fillet_1.face (freeform) R=5.0mm`
- [x] Hover over face with no special context → shows origin (current behavior preserved)
- [x] No crash for faces without antiparallel pairs
- [x] Wall thickness computation unit tests pass (7 new, 397 total)

---

## Dependencies & Risks

```
Phase 1 (Multi-Level Contour)     ← Independent
Phase 2 (Dimension Readout)       ← Independent
No dependency between them — can be implemented in parallel.
```

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Multi-level contour too slow for fine step-down | Long compute times for aggressive roughing params | Document performance characteristics. Per-level cost already benchmarked. |
| Wall thickness wrong for complex shapes with many parallel faces | Misleading readout | Return closest antiparallel pair. If no pair exists, show origin instead. |
| `EdgeBreak.faces()` change breaks downstream consumers | Type error in MCP server or tests | `edgeBreakSize` is optional — existing consumers unaffected. |
| `BaseContourParams` refactor breaks existing `ContourToolpathParams` usage | Compile errors | `extends BaseContourParams` is additive — existing fields remain. |

---

## Deferred (Future Plans)

The following features from the original brainstorm are explicitly deferred, with rationale from the three-reviewer analysis:

### Feature Registry
**Why deferred:** The dimension readout (Phase 2) works without it. Chamfer/fillet size comes from `EdgeBreak.faces()`. Wall thickness from topology. Hole diameter from `FaceDescriptor.radius`. Build the registry when interactive editing (sliders) proves necessary — not as speculative infrastructure.

### Interactive Parameter Editing (Sliders)
**Why deferred:** Fights the code-first thesis. The primary author is the LLM, which edits code naturally. Human users can edit the DSL directly. Code rewriting via regex is fragile. If needed later, DHH suggested an additive `set()` approach instead of regex rewriting — append `set(featureName, paramName, value)` to the code rather than parsing/replacing literals.

### Constraint Solver (Semantic DSL v3)
**Why deferred:** LLMs compute coordinates trivially from face origins returned by readback. 3-5 sessions of work for axis-aligned-only constraints is poor effort-to-value. Revisit when non-axis-aligned faces are supported, or when there's evidence LLMs struggle with coordinate math.

---

## References

- Contour toolpath: [toolpath.ts:290-427](packages/sdf-kernel/src/toolpath.ts#L290-L427)
- ContourToolpathParams: [toolpath.ts:295-304](packages/sdf-kernel/src/toolpath.ts#L295-L304)
- Marching squares: [marching-squares.ts](packages/sdf-kernel/src/marching-squares.ts)
- EdgeBreak node: [sdf.ts:998-1078](packages/sdf-kernel/src/sdf.ts#L998-L1078)
- Face highlighting: [main.ts:362-479](packages/viewer/src/main.ts#L362-L479)
- showFaceInfo: [main.ts:415-433](packages/viewer/src/main.ts#L415-L433)
- FaceMapData: [kernel-bridge.ts:72-76](packages/viewer/src/kernel-bridge.ts#L72-L76)
- meshToResult face classification: [kernel-bridge.ts:319-356](packages/viewer/src/kernel-bridge.ts#L319-L356)
- FaceDescriptor type: [topology.ts](packages/sdf-kernel/src/topology.ts)
- Brainstorm (CAM engine): [docs/brainstorms/2026-02-19-cam-toolpath-engine-brainstorm.md](docs/brainstorms/2026-02-19-cam-toolpath-engine-brainstorm.md)
- Previous plan (chamfer/contour/viewer): [docs/plans/2026-02-20-feat-chamfer-contour-viewer-plan.md](docs/plans/2026-02-20-feat-chamfer-contour-viewer-plan.md)
