---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, quality]
dependencies: []
---

# Empty Mesh Bounds Should Be Infinity, Not [0,0,0]

## Problem Statement
When marching cubes produces 0 triangles, bounds are set to `{ min: [0,0,0], max: [0,0,0] }`. This is semantically wrong — an empty mesh has no meaningful bounds.

## Findings
- **Code Quality**: meshMin/meshMax init to Infinity/-Infinity is correct; the override to [0,0,0] on line 91-94 is unnecessary
- **Simplicity Reviewer**: These 4 lines can be deleted

## Proposed Solutions
Delete lines 91-94 in marching-cubes.ts. Let empty meshes keep `{ min: [Inf,Inf,Inf], max: [-Inf,-Inf,-Inf] }`.

## Acceptance Criteria
- [ ] Empty mesh bounds are Infinity (or clearly documented convention)
- [ ] Update empty mesh test expectations if needed

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-17 | Identified by Code Quality + Simplicity agents | P2 finding |
| 2026-02-18 | Fixed: removed [0,0,0] override, empty mesh keeps Infinity bounds | Complete |
