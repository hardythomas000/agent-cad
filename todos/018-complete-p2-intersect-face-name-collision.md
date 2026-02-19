---
status: complete
priority: p2
issue_id: "018"
tags: [code-review, correctness, named-topology]
dependencies: []
---

# 018: Intersect/SmoothIntersect Missing Face Name Collision Handling

## Problem Statement

`Intersect.faces()` and `SmoothIntersect.faces()` blindly concatenate both children's face arrays:

```typescript
faces(): FaceDescriptor[] {
    return [...this.a.faces(), ...this.b.faces()];
}
```

When intersecting two shapes with the same face names (e.g., `sphere(10).intersect(sphere(20))` — both have "surface"), the result contains duplicate face names. The `face()` lookup silently returns only the first match.

## Findings

**Source:** TypeScript Reviewer (H3)

Union handles this correctly with `a./b.` prefixing (lines 489-501). Intersect was not given the same treatment.

## Proposed Solutions

### Option A: Apply same collision logic as Union (Recommended)
Copy the name-collision detection from Union into Intersect/SmoothIntersect. Or share via extracted helper (see #017).
- **Effort:** Small (10 min) | **Risk:** None

## Acceptance Criteria

- [ ] `sphere(10).intersect(sphere(20))` produces `a.surface` and `b.surface`
- [ ] Test added for this case
- [ ] All tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | No test caught this because no test exercises name collision on intersect |
