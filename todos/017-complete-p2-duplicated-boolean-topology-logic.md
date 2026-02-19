---
status: complete
priority: p2
issue_id: "017"
tags: [code-review, duplication, named-topology]
dependencies: []
---

# 017: Duplicated faces()/classifyPoint() Across Sharp/Smooth Boolean Pairs

## Problem Statement

41 lines of character-for-character identical code across 6 method pairs:

- Union.faces() == SmoothUnion.faces() (12 lines each)
- Union.classifyPoint() == SmoothUnion.classifyPoint() (6 lines each)
- Subtract.faces() == SmoothSubtract.faces() (9 lines each)
- Subtract.classifyPoint() == SmoothSubtract.classifyPoint() (8 lines each)
- Intersect.faces() == SmoothIntersect.faces() (3 lines each)
- Intersect.classifyPoint() == SmoothIntersect.classifyPoint() (6 lines each)

## Findings

**Source:** TypeScript Reviewer (H2), Pattern Recognition (2.1)

## Proposed Solutions

### Option A: Extract free functions (Recommended)
```typescript
function mergeUnionFaces(a: SDF, b: SDF): FaceDescriptor[] { /* shared */ }
function subtractFaces(a: SDF, b: SDF, featureName: string): FaceDescriptor[] { /* shared */ }
function intersectFaces(a: SDF, b: SDF): FaceDescriptor[] { /* shared */ }
function booleanClassify(a: SDF, b: SDF, p: Vec3, type: 'union'|'subtract'|'intersect', featureName?: string): string | null { /* shared */ }
```
- **Effort:** Small (30 min) | **Risk:** None

## Acceptance Criteria

- [ ] Zero duplicated topology logic between sharp/smooth pairs
- [ ] All 262 tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | 41 lines exact duplication |
