---
status: complete
priority: p3
issue_id: "022"
tags: [code-review, named-topology, simplicity]
dependencies: []
---

# 022: Dead featureName Parameter on Union/Intersect/SmoothUnion/SmoothIntersect

## Problem Statement

Four classes accept `featureName` in their constructor but never read it:
- `Union` (line 477) — uses `a./b.` collision prefix instead
- `Intersect` (line 565) — concatenates faces with no prefixing
- `SmoothUnion` (line 605) — uses `a./b.` collision prefix instead
- `SmoothIntersect` (line 679) — concatenates faces with no prefixing

The fluent API methods and MCP tools all pass through a parameter that is silently ignored.

## Proposed Solutions

### Option A: Remove parameter from these 4 classes (Recommended)
- Keep `featureName` only on Subtract and SmoothSubtract where it's used
- Update fluent API on base class
- **Effort:** Small | **Risk:** Low

### Option B: Use featureName for prefix instead of a./b.
- Union uses `featureName` as prefix when provided, falls back to `a./b.`
- **Effort:** Small | **Risk:** Low — but adds complexity for unclear value

## Acceptance Criteria

- [ ] No parameter accepted that is never read
- [ ] MCP tools updated to match
- [ ] All tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Misleading API surface |
