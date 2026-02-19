---
title: "feat: Complete edge topology metadata and MCP exposure"
type: feat
date: 2026-02-19
---

# Complete Edge Topology Metadata and MCP Exposure

## Overview

Fix 5 gaps in edge propagation across SDF node classes and add `query_edges` / `query_edge` MCP tools. Edges become queryable by the LLM agent, enabling reasoning about face-pair intersections for future toolpath edge following (deburring, contour profiling, selective chamfer).

## Problem Statement

Named face topology shipped and works across all 20 node classes. But edge topology is incomplete — 6 node classes silently drop edges (return `[]`), Union/Intersect don't handle edge name collisions, and no MCP tools expose edges. The LLM agent can ask "what faces does this have?" but not "what edges?"

## Proposed Solution

Complete edge metadata propagation using the same patterns established by face topology. No curve geometry — just descriptors (name, face pair, kind, midpoint). Two new MCP tools mirror `query_faces`/`query_face`.

## Technical Approach

### Design Decisions (from brainstorm + SpecFlow)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `mergeEdges()` face references | Update `faces` tuple when prefixing | Edge face refs must match actual face names after collision rename |
| Collision detection trigger | Face-level (same as `mergeFaces()`) | Edges derive from faces — if faces collide, edges must follow |
| Polygon extrude edges | 2 `curve` edges (`top.wall`, `bottom.wall`) | Single `wall` face can't support per-segment edges without face decomposition |
| Revolve polygon edges | 0 edges | Single `surface` face, like torus/sphere |
| Shell edge midpoints | Inherit child midpoints unchanged | Midpoints are documented as "approximate" |
| `edge()` error message | Include available edge names + count | Match `face()` error pattern for LLM self-correction |

### Implementation

#### 1. `mergeEdges()` helper (`sdf.ts`)

New free function mirroring `mergeFaces()`. Key difference: must also update the `faces` tuple references.

```typescript
function mergeEdges(a: SDF, b: SDF): EdgeDescriptor[] {
  const aEdges = a.edges();
  const bEdges = b.edges();
  const aFaceNames = new Set(a.faces().map(f => f.name));
  const hasFaceCollision = bFaces.some(f => aFaceNames.has(f.name));
  if (hasFaceCollision) {
    return [
      ...aEdges.map(e => ({
        ...e,
        name: `a.${e.name}`,
        faces: [`a.${e.faces[0]}`, `a.${e.faces[1]}`] as [string, string],
      })),
      ...bEdges.map(e => ({
        ...e,
        name: `b.${e.name}`,
        faces: [`b.${e.faces[0]}`, `b.${e.faces[1]}`] as [string, string],
      })),
    ];
  }
  return [...aEdges, ...bEdges];
}
```

#### 2. Update Union / Intersect (`sdf.ts`)

Replace naive concatenation with `mergeEdges()`:

- `Union.edges()` → `return mergeEdges(this.a, this.b);`
- `Intersect.edges()` → `return mergeEdges(this.a, this.b);`

#### 3. Smooth boolean edge propagation (`sdf.ts`)

Add `edges()` overrides that delegate to the same logic as sharp counterparts:

- `SmoothUnion.edges()` → `return mergeEdges(this.a, this.b);`
- `SmoothSubtract.edges()` → same prefixing logic as `Subtract.edges()`, using `this.resolvedFeatureName`
- `SmoothIntersect.edges()` → `return mergeEdges(this.a, this.b);`

#### 4. Shell edge doubling (`sdf.ts`)

Mirror how `Shell.faces()` doubles faces with `outer_`/`inner_` prefixes:

```typescript
edges(): EdgeDescriptor[] {
  const childEdges = this.child.edges();
  return [
    ...childEdges.map(e => ({
      ...e,
      name: `outer_${e.name}`,
      faces: [`outer_${e.faces[0]}`, `outer_${e.faces[1]}`] as [string, string],
    })),
    ...childEdges.map(e => ({
      ...e,
      name: `inner_${e.name}`,
      faces: [`inner_${e.faces[0]}`, `inner_${e.faces[1]}`] as [string, string],
    })),
  ];
}
```

#### 5. Extrude edges (`sdf.ts`)

Profile-dependent edge table using `instanceof` narrowing (pattern from todo #014):

| Profile | Edges | Kind |
|---------|-------|------|
| `Circle2D` | `top.wall`, `bottom.wall` | `arc` |
| `Rect2D` | 12 edges (same as Box) | `line` |
| `Polygon2D` | `top.wall`, `bottom.wall` | `curve` |

Circle2D midpoints use `radius` at `±halfH`. Rect2D midpoints computed from profile `halfW`/`halfH` and extrude `halfHeight`. Polygon2D midpoints at first vertex position projected to top/bottom.

#### 6. Revolve edges (`sdf.ts`)

Profile-dependent, conditional on inner wall existence:

| Profile | Condition | Edges | Kind |
|---------|-----------|-------|------|
| `Circle2D` | — | 0 (torus-like) | — |
| `Rect2D` | `innerR > 0` | 4: `top.outer_wall`, `bottom.outer_wall`, `top.inner_wall`, `bottom.inner_wall` | `arc` |
| `Rect2D` | `innerR ≤ 0` | 2: `top.outer_wall`, `bottom.outer_wall` | `arc` |
| `Polygon2D` | — | 0 (single freeform surface) | — |

#### 7. Improve `edge()` error message (`sdf.ts`)

```typescript
edge(face1: string, face2: string): EdgeDescriptor {
  const all = this.edges();
  const e = all.find(ed => ...);
  if (!e) {
    const available = all.map(ed => ed.name).join(', ');
    throw new Error(
      `Edge between "${face1}" and "${face2}" not found. ` +
      `This shape has ${all.length} edge(s): [${available}]`
    );
  }
  return e;
}
```

#### 8. MCP tools (`tools.ts`)

**`query_edges`** — mirrors `query_faces`:
```typescript
server.tool('query_edges', 'List all named edges...', {
  shape: z.string(),
}, async ({ shape }) => {
  const s = registry.get(shape).shape;
  const edges = s.edges();
  return { content: [{ type: 'text', text: JSON.stringify({
    shape_id: shape, edge_count: edges.length, edges
  })}]};
});
```

**`query_edge`** — mirrors `query_face`:
```typescript
server.tool('query_edge', 'Get edge at intersection of two named faces...', {
  shape: z.string(),
  face1: z.string(),
  face2: z.string(),
}, async ({ shape, face1, face2 }) => {
  const s = registry.get(shape).shape;
  const edge = s.edge(face1, face2);
  return { content: [{ type: 'text', text: JSON.stringify({
    shape_id: shape, edge
  })}]};
});
```

**`get_shape`** — add `edge_count`:
```typescript
const result = { shape_id, type, readback, face_count, edge_count: entry.shape.edges().length };
```

#### 9. Update tool count comments

MCP server tool count increases from 36 to 38 (2 new topology tools). Update comments in `tools.ts` and `CLAUDE.md`.

### Files Changed

| File | Changes |
|------|---------|
| `packages/sdf-kernel/src/sdf.ts` | `mergeEdges()`, update Union/Intersect/SmoothUnion/SmoothSubtract/SmoothIntersect/Shell/Extrude/Revolve `edges()`, improve `edge()` error |
| `packages/mcp-server/src/tools.ts` | Add `query_edges`, `query_edge` tools, add `edge_count` to `get_shape` |
| `packages/sdf-kernel/test/topology.test.ts` | ~25 new edge tests |
| `CLAUDE.md` | Update tool count (36→38) |

Estimated: ~200 LOC kernel, ~50 LOC MCP, ~200 LOC tests.

## Acceptance Criteria

### Kernel
- [ ] `mergeEdges()` prefixes edge names AND face references on collision
- [ ] `Union.edges()` and `Intersect.edges()` use `mergeEdges()`
- [ ] `SmoothUnion.edges()` delegates to `mergeEdges()`
- [ ] `SmoothSubtract.edges()` prefixes with `resolvedFeatureName` (matches Subtract)
- [ ] `SmoothIntersect.edges()` delegates to `mergeEdges()`
- [ ] `Shell.edges()` doubles with `outer_`/`inner_` prefixes, face refs updated
- [ ] `Extrude(Circle2D).edges()` → 2 arcs
- [ ] `Extrude(Rect2D).edges()` → 12 lines
- [ ] `Extrude(Polygon2D).edges()` → 2 curves
- [ ] `Revolve(Circle2D).edges()` → 0
- [ ] `Revolve(Rect2D).edges()` → 2 or 4 arcs (conditional on inner wall)
- [ ] `Revolve(Polygon2D).edges()` → 0
- [ ] `edge()` error includes available edge names and count

### MCP
- [ ] `query_edges(shape_id)` returns `{ shape_id, edge_count, edges }`
- [ ] `query_edge(shape_id, face1, face2)` returns single edge (bidirectional)
- [ ] `get_shape` includes `edge_count`

### Tests
- [ ] `mergeEdges()` with collision (two boxes unioned) — names + face refs prefixed
- [ ] `mergeEdges()` without collision (box + sphere) — no prefixing
- [ ] SmoothSubtract edges match Subtract structure
- [ ] Shell produces 2× edges with correct prefixes
- [ ] Extrude(circle) → 2 arcs, Extrude(rect) → 12 lines, Extrude(polygon) → 2 curves
- [ ] Revolve(rect) conditional edge count
- [ ] Chained: `box.subtract(cyl, "hole").shell(2)` — edges propagate through chain
- [ ] `edge()` error message quality
- [ ] All existing 262 tests still pass

## Verification

```bash
npm run build    # All 3 packages compile clean
npm test         # 262+ existing tests pass, ~25 new edge tests pass
```

MCP test:
```
create_box(100, 60, 30)           → shape_1
query_edges(shape_1)              → 12 line edges
create_cylinder(5, 40)            → shape_2
boolean_subtract(shape_1, shape_2, feature_name="hole_1") → shape_3
query_edges(shape_3)              → 14 edges (12 box + 2 prefixed cylinder)
query_edge(shape_3, "top", "front") → { name: "top.front", kind: "line", ... }
query_edge(shape_3, "hole_1.top_cap", "hole_1.barrel") → { kind: "arc", ... }
```

## References

- Brainstorm: `docs/brainstorms/2026-02-19-edge-topology-brainstorm.md`
- Review finding: `todos/021-pending-p3-edge-topology-incomplete.md`
- Related completed findings: #014, #017, #018, #020, #023
- VISION.md Design Principle 3 (Named Topology)
