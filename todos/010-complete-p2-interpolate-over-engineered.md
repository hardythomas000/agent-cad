---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, simplicity]
dependencies: []
---

# interpolate() has 4 guards where 2 suffice

## Problem Statement
The `interpolate()` function in marching-cubes.ts has four separate guards (v1~0, v2~0, denom~0, t-clamp) when only the denom guard + t-clamp are needed. The v1/v2 early returns are redundant with the clamped lerp.

## Findings
- **Simplicity Reviewer**: The t-clamp alone handles every case. If v1~0 then t~0 and lerp returns ~p1. If v2~0 then t~1 and lerp returns ~p2.
- Simpler 2-line version:
```typescript
const denom = v2 - v1;
const t = Math.abs(denom) < 1e-10 ? 0.5 : Math.max(0, Math.min(1, -v1 / denom));
```

## Proposed Solutions

### Option A: Simplify to denom guard + t-clamp (Recommended)
Remove the v1 and v2 early returns. Keep denom guard and t-clamp.
- **Effort**: Small
- **Risk**: Low (behavior unchanged, just fewer branches)

### Option B: Keep as-is
The extra guards are harmless and make intent explicit.
- **Effort**: None
- **Risk**: None

## Acceptance Criteria
- [ ] interpolate() produces identical output with fewer branches
- [ ] All 104 tests still pass

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-18 | Identified by Simplicity Reviewer | P2 finding |
| 2026-02-18 | Simplified to denom guard + t-clamp (2 lines instead of 4 branches) | Complete |
