---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, architecture]
dependencies: []
---

# Mesh Cache Not Cleared on Shape Delete

## Problem Statement
When `registry.remove(id)` deletes a shape, the corresponding mesh in `meshCache` is not deleted. This leaks memory and leaves stale data.

## Findings
- **Architecture Strategist**: `remove()` at `registry.ts:54-59` only calls `shapes.delete(id)`, not `meshCache.delete(id)`
- **Simplicity Reviewer**: Questions whether mesh cache is needed at all

## Proposed Solutions

### Option A: Add meshCache.delete to remove() (Recommended)
```typescript
export function remove(id: string): void {
  if (!shapes.has(id)) throw new Error(...);
  shapes.delete(id);
  meshCache.delete(id);  // Add this
}
```
- **Effort**: Small (1 line)
- **Risk**: None

## Acceptance Criteria
- [ ] Deleting a shape also clears its cached mesh
- [ ] `clear()` still works correctly (already clears both)

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-17 | Identified by Architecture Strategist | P1 finding |
| 2026-02-18 | Fixed: added meshCache.delete(id) in registry.remove() | Complete |
