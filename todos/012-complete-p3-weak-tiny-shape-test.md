---
status: complete
priority: p3
issue_id: "012"
tags: [code-review, quality]
dependencies: []
---

# "Very small shape" test asserts nothing useful

## Problem Statement
The test "meshes a very small shape relative to resolution" asserts `triangleCount >= 0` (always true) and checks NaN on a potentially empty vertex array (vacuously true). It does not meaningfully exercise the code.

## Findings
- **Simplicity Reviewer**: sphere(1) at resolution 2 might not produce any triangles, so the NaN check on zero vertices is vacuously true. The test is a weaker duplicate of the "produces no NaN vertices" test.

## Proposed Solutions

### Option A: Strengthen with finer resolution
Change to `marchingCubes(tiny, 0.5)` so it must produce triangles, then check NaN.
- **Effort**: Trivial

### Option B: Delete the test
The "produces no NaN vertices" test already exercises interpolation safety.
- **Effort**: Trivial

## Acceptance Criteria
- [ ] Test either produces and validates triangles, or is removed

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-18 | Identified by Simplicity Reviewer | P3 finding |
| 2026-02-18 | Fixed: resolution 0.5 forces triangle generation, asserts >10 triangles | Complete |
