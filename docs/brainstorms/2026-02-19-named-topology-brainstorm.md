# Named Topology + Semantic DSL — Brainstorm

**Date:** 2026-02-19
**Participants:** Hardy Thomas, Claude
**Status:** Ready for planning

---

## What We're Building

A named topology system for the SDF kernel that lets LLMs (and the viewer DSL) reference faces and edges by semantic name instead of coordinates. This bridges Phase 2 (SDF kernel) and Phase 6 (toolpath engine) — without it, the agent has to hallucinate coordinates, which fails ~95% of the time.

**The sentence that captures it:**
> `part.face("top")` instead of `[0, 1, 0]` at `y = 30`.

### Two use cases (both required):

1. **Toolpath targeting** — "machine the top face", "drill through the top" → kernel knows where "top" is
2. **Selective operations** — "fillet the edges where the pocket meets the top", "chamfer the front edge" → kernel applies modifications to named features

---

## Why This Approach

### Approach: Analytical Metadata (No Mesh)

SDFs don't have explicit faces — they're continuous distance fields. We're inventing face identity on top of the math.

**How it works:** Each primitive carries a static face table derived from its SDF formula. A `Box` is `max(|x|-w, |y|-h, |z|-d)` — each component of that `max` IS a face. The kernel knows the face normals and positions analytically, without meshing.

**Why not mesh-based:** Meshing is for human eyes and STL export. The SDF is the canonical representation. Coupling topology to mesh resolution would violate the SDF-first principle and make queries slow.

**Why not full B-Rep topology:** Computing exactly how faces split during booleans is essentially reimplementing B-Rep, which defeats the SDF advantage. One level of genealogy covers 90% of machining use cases.

### Rejected alternatives:

| Approach | Why rejected |
|----------|-------------|
| Sample-based (mesh) | Couples topology to meshing, resolution-dependent, slow for queries |
| Full recursive genealogy | Reimplements B-Rep topology tracking, over-engineered for current needs |
| MCP tools only (no kernel methods) | Harder to test, viewer DSL can't use topology |

---

## Key Decisions

### 1. Face identity: Analytical, not mesh-based
Each SDF primitive carries a compile-time face table. Face lookup at a point = evaluate gradient, compare to known face normals.

### 2. Genealogy depth: One level, designed to extend
After `subtract(A, B)`:
- A's faces that survive keep their names
- B's faces that become internal get prefixed (`hole_1.wall`, `hole_1.floor`)
- New faces from the cut get named by feature intent

One level covers: drill holes, pockets, slots, chamfers — the 90% case. Nested features (pocket in pocket) reference by primitive name. The architecture should allow future recursive tracking without rewrite.

### 3. API surface: Kernel methods + MCP tools
- **Kernel:** `shape.faces()`, `shape.face("top")`, `shape.edges()`, `shape.edge("top", "front")`
- **MCP:** `query_faces(shape_id)`, `query_face(shape_id, "top")`, `query_edges(shape_id)`
- Kernel is source of truth, MCP wraps it. Both the viewer DSL and the agent can use topology.

### 4. Naming convention: Graduated system

| Shape type | Naming | Examples |
|-----------|--------|---------|
| Box | Directional | `top`, `bottom`, `front`, `back`, `left`, `right` |
| Cylinder | Directional + geometric | `top_cap`, `bottom_cap`, `barrel` |
| Cone | Geometric | `base_cap`, `surface` |
| Sphere | Generic | `surface` |
| Torus | Generic | `surface` |
| Boolean feature | Intent-based | `hole_1.wall`, `hole_1.floor`, `pocket_1.wall`, `pocket_1.floor` |
| Organic/freeform | Generic numbered | `surface`, `surface_1`, `surface_2` |

This graduated system handles everything from prismatic machining parts to doubly-curved organic shapes.

### 5. Face descriptor: What `.face("top")` returns

```typescript
interface FaceDescriptor {
  name: string;           // "top", "hole_1.wall"
  normal: Vec3;           // outward normal (analytical)
  kind: 'planar' | 'cylindrical' | 'conical' | 'spherical' | 'toroidal' | 'freeform';
  origin?: Vec3;          // for planar: a point on the face
  radius?: number;        // for cylindrical/spherical
  bounds?: BoundingBox;   // AABB of the face region
}
```

### 6. Edge identification: By face intersection

```typescript
shape.edge("top", "front")  // returns the edge where top meets front
```

An edge is the intersection of two named faces. The kernel doesn't need to compute the edge geometry explicitly — it can return an `EdgeDescriptor` with the two face names and approximate position (midpoint of the intersection line/curve).

---

## Open Questions

1. **How does the LLM name boolean features?** Options:
   - Auto-naming: `subtract_1`, `subtract_2` (simple but not semantic)
   - LLM provides name: `subtract(box, cyl, name="hole_1")` (semantic but requires LLM to name things)
   - **Recommendation:** LLM provides optional name, auto-name as fallback

2. **What about transforms?** If you translate a box, do face names survive? (Yes — transforms don't change topology, only position. The face table transforms with the shape.)

3. **Selective fillet/chamfer API:** How does `fillet("pocket_1.floor_edges", 3)` work in SDF? Probably: identify the edge region (intersection of floor and walls), apply localized rounding. This is a separate implementation challenge from the naming system.

4. **Performance:** Face classification at a point requires evaluating the gradient + comparing to known normals. For toolpath generation (millions of points), this needs to be fast. Can we cache the face table per shape?

5. **Readback enrichment:** Should `SDFReadback` include face lists by default, or only on request via `query_faces()`? Adding faces to every readback increases token count. **Recommendation:** Optional — enriched readback when requested, basic readback by default.

---

## Scope for Phase 1 Implementation

### In scope:
- `FaceDescriptor` and `EdgeDescriptor` types
- Face tables for all 6 primitives (Box, Cylinder, Cone, Sphere, Torus, Plane)
- `.faces()` and `.face(name)` methods on SDF base class
- `.edges()` and `.edge(face1, face2)` on SDF base class
- One-level boolean genealogy (face naming through subtract/intersect)
- `children()` traversal method on SDF base class
- `query_faces` and `query_edges` MCP tools
- Enriched readback (optional faces field)

### Out of scope (future):
- Selective fillet/chamfer on named edges (needs SDF modification, not just naming)
- Recursive genealogy (multi-level face tracking)
- Feature constructors (`pocket("top", ...)`, `hole("top", ...)`)
- Organic shape face decomposition (NURBS-aware naming)
- Edge geometry computation (actual curve extraction)

---

## What Success Looks Like

An LLM agent can:
```
1. create_box(100, 60, 30)           → shape_1
2. create_cylinder(5, 40)            → shape_2
3. translate(shape_2, 50, 30, 15)    → shape_3
4. boolean_subtract(shape_1, shape_3, name="hole_1")  → shape_4
5. query_faces(shape_4)              → ["top","bottom","front","back","left","right","hole_1.wall","hole_1.floor"]
6. query_face(shape_4, "top")        → {normal:[0,1,0], kind:"planar", origin:[50,30,30]}
7. generate_surfacing_toolpath(shape_4, face="top")  → toolpath targeting the top face
```

No coordinate hallucination. The agent asks the kernel "what faces exist?" and the kernel tells it.

---

*Next: Run `/workflows:plan` to create implementation plan.*
