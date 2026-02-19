---
status: complete
priority: p2
issue_id: "019"
tags: [code-review, security, validation, mcp]
dependencies: []
---

# 019: NaN/Infinity Accepted by MCP Coordinate Parameters

## Problem Statement

The new `classify_point` tool and existing `evaluate_point` and `drop_cutter` tools use `z.number()` for x/y/z coordinates, which accepts `NaN`, `Infinity`, and `-Infinity`. The existing `create_polygon` tool already uses `z.number().finite()`, so the pattern is known but not applied consistently.

NaN in math comparisons causes arbitrary face classification. `JSON.stringify(NaN)` produces `null`, which is valid JSON but loses information.

## Findings

**Source:** Security Sentinel (F4)

## Proposed Solutions

### Option A: Change z.number() to z.number().finite() (Recommended)
One-word change per coordinate parameter across classify_point, evaluate_point, drop_cutter.
- **Effort:** Trivial (5 min, ~9 one-word edits) | **Risk:** None

## Acceptance Criteria

- [ ] All x/y/z coordinate params on classify_point, evaluate_point, drop_cutter use `.finite()`
- [ ] NaN rejected with clear error
- [ ] All tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Quick win |
