---
status: complete
priority: p3
issue_id: "021"
tags: [code-review, named-topology, architecture, agent-native]
dependencies: ["014"]
---

# 021: Edge Topology Incomplete and Unexposed

## Problem Statement

Edge topology is partially implemented in the kernel but has multiple gaps and no MCP exposure:
1. **No MCP tools** — `query_edges` and `query_edge` don't exist
2. **Smooth booleans return []** — SmoothUnion/SmoothSubtract/SmoothIntersect inherit base `return []`
3. **Shell returns []** — Should double edges with outer_/inner_ prefixes
4. **Union.edges() no collision handling** — Concatenates without prefix on name collision
5. **Boolean intersection edges not computed** — The hard part (new edges where A meets B) was never attempted

**Competing perspectives:**
- **Agent-native reviewer:** Add `query_edges` MCP tool — agents need edges for fillet/chamfer
- **Simplicity reviewer:** Remove EdgeDescriptor entirely (YAGNI) — zero consumers, incomplete, boolean intersection is the hard part

## Proposed Solutions

### Option A: Complete and expose edges
- Add edges() to smooth booleans and Shell
- Fix Union.edges() collision handling
- Add query_edges/query_edge MCP tools
- **Effort:** Medium | **Risk:** Low

### Option B: Remove edges entirely (YAGNI)
- Delete EdgeDescriptor, EdgeKind, all edges() overrides, edge() lookup, edge tests
- ~143 LOC removed
- Re-add when actually needed (with proper boolean intersection edges)
- **Effort:** Small | **Risk:** Low

### Option C: Keep kernel implementation, defer MCP exposure
- Fix smooth booleans and collision handling but don't add MCP tools yet
- Document as internal-only until edge queries are actually needed
- **Effort:** Small | **Risk:** Low

## Recommended Action

Option A chosen (complete and expose edges). Extrude/Revolve leaf edges deferred per plan review consensus (YAGNI — no consumer until edge-following toolpaths).

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Contentious finding — agents disagree |
| 2026-02-19 | Resolved | Brainstorm → plan → plan review → implementation. Commit 087254f. mergeEdges(), smooth booleans, shell, query_edges MCP tool. 21 new tests (283 total). |
