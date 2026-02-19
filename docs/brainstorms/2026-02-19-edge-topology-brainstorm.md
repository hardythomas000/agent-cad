# Edge Topology Completion — Brainstorm

**Date:** 2026-02-19
**Status:** Decision made → proceed to plan
**Related:** #021 (pending P3 finding), named topology brainstorm

## What We're Building

Complete the edge topology metadata layer and expose it via MCP tools. Fix the 5 gaps in the current edge implementation so edges propagate correctly through all SDF operations, and add `query_edges` + `query_edge` MCP tools so the LLM agent can reason about edges.

**Not building (deferred):** Actual curve geometry (start/end points, arc parameters). That comes later when edge-following toolpaths are built.

## Why This Approach

- **Use case:** Toolpath edge following (deburring, contour profiling, selective chamfer) — but other priorities come first
- **YAGNI applied:** Metadata + MCP is the minimum that makes edges useful to the LLM agent. Curve geometry extraction is deferred until there's a concrete consumer (edge-following toolpath engine)
- **Foundation:** Edge names and face-pair relationships are stable identifiers. Adding geometry later extends `EdgeDescriptor` without breaking existing code

## Key Decisions

1. **Approach A chosen over B and C** — metadata + MCP exposure, defer curve geometry
2. **Smooth booleans** will propagate edges like their sharp counterparts (currently return `[]`)
3. **Shell modifier** will double edges with `outer_`/`inner_` prefixes (currently returns `[]`)
4. **Extrude/Revolve** will get edge tables (face-pair intersections)
5. **Union/Intersect edge collision** will use the `mergeFaces()` pattern (prefix `a.`/`b.`)
6. **Boolean intersection edges** (new edges at cut boundary) are out of scope — these require numerical SDF tracing and belong in Approach C

## Scope

### In Scope (~250 LOC)
- Fix `SmoothUnion.edges()`, `SmoothSubtract.edges()`, `SmoothIntersect.edges()` — propagate like sharp variants
- Fix `Shell.edges()` — double with `outer_`/`inner_` prefixes, inner normals inverted
- Add `Extrude.edges()` — cap-to-wall edges based on profile type
- Add `Revolve.edges()` — profile-dependent edge table
- Add collision handling to `Union.edges()` and `Intersect.edges()` — mirror `mergeFaces()` pattern
- Add `query_edges(shape_id)` MCP tool → `{ edge_count, edges: EdgeDescriptor[] }`
- Add `query_edge(shape_id, face1, face2)` MCP tool → single `EdgeDescriptor`
- Tests for all edge propagation paths (~20-30 new tests)

### Out of Scope
- Curve geometry (start/end points, arc center/radius) — deferred to edge-following toolpath phase
- Boolean intersection edges (cut-boundary curves) — requires numerical SDF tracing
- Edge loop detection (ordered edges around a face boundary) — needed for contour profiling, future phase
- Selective fillet/chamfer in SDF — separate feature

## Approaches Considered

### A: Metadata + MCP (Chosen)
Fix gaps, add MCP tools. ~250 LOC. LLM can query and reason about edges. Geometry deferred.

### B: Metadata + Analytical Geometry
Also add start/end/center/radius to primitive edges. ~400 LOC. Richer but no near-term consumer.

### C: Full Curve Extraction
Including boolean intersection tracing. ~800+ LOC. Research-grade complexity. Premature.

## Open Questions

None — ready for planning.
