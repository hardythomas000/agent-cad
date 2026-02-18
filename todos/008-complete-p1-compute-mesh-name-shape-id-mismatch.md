---
status: complete
priority: p1
issue_id: "008"
tags: [code-review, agent-native, data-integrity]
dependencies: []
---

# compute_mesh name param creates shape_id/cache-key mismatch

## Problem Statement
When `compute_mesh` is called with an optional `name` parameter, the response returns `shape_id: name` but the mesh is cached under `entry.id` (the original shape key). An LLM calling `export_mesh` with the returned `shape_id` will fail because the mesh is not cached under that key.

This is a NEW BUG introduced by the fix commits — it breaks the compute_mesh → export_mesh workflow when `name` is provided.

## Findings
- **Agent-Native Reviewer**: `tools.ts:381` returns `shape_id: name ?? entry.id` but `tools.ts:393` caches under `registry.cacheMesh(entry.id, mesh)`. These keys diverge when `name` is provided.
- The `name` parameter on `compute_mesh` is cosmetic — it does NOT create a new registry entry.
- LLM will call `export_mesh({ shape: "my_bracket" })` but the mesh is cached under `"shape_1"`.

## Proposed Solutions

### Option A: Remove `name` parameter from compute_mesh (Recommended)
The mesh is not a new shape — it is computed geometry for an existing shape. The `name` parameter is misleading.
- **Effort**: Small
- **Risk**: Low (the param was just added)

### Option B: Always use entry.id in the response
Change line 381 to `shape_id: entry.id` regardless of `name` parameter.
- **Effort**: Trivial
- **Risk**: Low

## Acceptance Criteria
- [ ] `compute_mesh` response `shape_id` matches the key used for mesh cache
- [ ] `export_mesh` succeeds after `compute_mesh` with a `name` parameter

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-18 | Identified by Agent-Native Reviewer (fix commit review) | P1 finding |
| 2026-02-18 | Fixed: compute_mesh response now always uses entry.id | Complete |
