---
status: complete
priority: p1
issue_id: "009"
tags: [code-review, data-integrity, security]
dependencies: []
---

# Stale mesh cache when shape name is overwritten

## Problem Statement
When a shape is re-created with the same name (e.g., after a boolean operation), `registry.create()` overwrites the shape entry but does NOT clear the old mesh from `meshCache`. The next `export_mesh` call silently exports the OLD pre-boolean geometry.

In a CAD/CAM context, exporting the wrong geometry could cause manufacturing defects.

## Findings
- **Security Sentinel**: `registry.ts:38` does `shapes.set(id, ...)` which silently overwrites, but `meshCache` is not cleared for that ID.
- **Agent-Native Reviewer**: Confirmed same finding. Workflow: create_box("bracket") → compute_mesh → boolean_subtract(name: "bracket") → export_mesh exports PRE-boolean mesh.
- Both agents flagged this independently.

## Proposed Solutions

### Option A: Clear mesh cache on overwrite (Recommended)
Add `meshCache.delete(id)` inside `create()` when `shapes.has(id)` is true.
```typescript
if (shapes.has(id)) {
  meshCache.delete(id);
}
shapes.set(id, { id, shape, type });
```
- **Effort**: Trivial (1 line)
- **Risk**: Low

## Acceptance Criteria
- [ ] Overwriting a shape by name clears any cached mesh for that name
- [ ] `export_mesh` after shape overwrite requires a new `compute_mesh` call

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-18 | Identified by Security Sentinel + Agent-Native Reviewer | P1 finding |
| 2026-02-18 | Fixed: meshCache.delete(id) added to create() on overwrite | Complete |
