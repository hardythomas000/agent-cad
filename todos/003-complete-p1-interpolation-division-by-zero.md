---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, data-integrity]
dependencies: []
---

# Division by Zero in Marching Cubes Edge Interpolation

## Problem Statement
The `interpolate()` function in `marching-cubes.ts:175` can divide by zero when `v1 ≈ v2` but both values are far from zero. This produces NaN vertices that propagate through the mesh and corrupt STL output.

## Findings
- **Data Integrity Guardian**: When `v1 = v2 = 5.0`, denominator `(v2 - v1) = 0` → `t = NaN`
- The current early-return guards (`Math.abs(v1) < 1e-10`) only catch values near zero, not equal non-zero values
- Standard marching cubes should only interpolate across sign changes, but floating-point edge cases can occur

## Proposed Solutions

### Option A: Add denominator guard + clamp t (Recommended)
```typescript
const denom = v2 - v1;
if (Math.abs(denom) < 1e-10) return midpoint(p1, p2);
const t = Math.max(0, Math.min(1, -v1 / denom));
```
- **Effort**: Small (3 lines)
- **Risk**: None — midpoint fallback is geometrically reasonable

## Acceptance Criteria
- [ ] No NaN vertices in any mesh output
- [ ] Interpolation t is always clamped to [0, 1]
- [ ] Add test: mesh a shape where SDF values are nearly equal at grid edge

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-17 | Identified by Data Integrity Guardian | P1 finding |
| 2026-02-18 | Fixed: denominator guard + midpoint fallback + t clamped to [0,1] | Complete |
