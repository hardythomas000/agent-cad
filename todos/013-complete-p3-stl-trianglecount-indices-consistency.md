---
status: complete
priority: p3
issue_id: "013"
tags: [code-review, data-integrity]
dependencies: []
---

# No consistency check between triangleCount and indices.length in exportSTL

## Problem Statement
`exportSTL()` trusts `mesh.triangleCount` for buffer allocation and loop bounds but does not verify it matches `mesh.indices.length / 3`. If these are inconsistent, the STL output would contain NaN vertices or uninitialized data.

## Findings
- **Security Sentinel**: Not exploitable for code execution, but could crash downstream slicers. Currently safe because `marchingCubes` sets `triangleCount: indices.length / 3`, but a future refactor could violate this invariant.

## Proposed Solutions

### Option A: Add assertion (Recommended)
```typescript
if (mesh.indices.length !== mesh.triangleCount * 3) {
  throw new Error('Mesh data inconsistent: indices.length does not match triangleCount * 3');
}
```
- **Effort**: Trivial (1 line)

## Acceptance Criteria
- [ ] Inconsistent mesh data throws a clear error

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-18 | Identified by Security Sentinel | P3 finding |
| 2026-02-18 | Fixed: assertion added to exportSTL | Complete |
