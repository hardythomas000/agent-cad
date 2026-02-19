---
status: complete
priority: p2
issue_id: "016"
tags: [code-review, architecture, named-topology, state-management]
dependencies: []
---

# 016: Module-Level Mutable Auto-Naming Counters

## Problem Statement

Two global mutable counters in `packages/sdf-kernel/src/sdf.ts` (lines 514, 640) increment forever with no reset:

```typescript
let nextSubtractId = 1;
let nextSmoothSubtractId = 1;
```

Problems: (1) test results depend on execution order, (2) face names are non-deterministic across server restarts, (3) two separate counters for the same concept, (4) session-level naming state lives in a pure geometry kernel.

## Findings

**Source:** All 6 review agents flagged this independently.

The test file works around it at line 327 by asserting `startsWith('subtract_')` instead of exact matching.

## Proposed Solutions

### Option A: Merge into single counter + export reset function
- Single `let nextFeatureId = 1` used by both Subtract and SmoothSubtract
- Export `resetAutoIds()` for test isolation
- **Effort:** Small | **Risk:** Low

### Option B: Move counter to registry layer
- Registry assigns auto-names at tool invocation, not at kernel construction
- **Effort:** Medium | **Risk:** Low

### Option C: Require explicit feature names (no auto-naming)
- Remove fallback; MCP tool requires `feature_name` on subtract
- **Effort:** Small | **Risk:** Medium (breaking change if LLM omits name)

## Recommended Action

Option A — simplest fix, preserves backward compatibility.

## Acceptance Criteria

- [ ] Single counter replaces two
- [ ] `resetAutoIds()` exported and callable from tests
- [ ] Test isolation verified (each test file resets)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Flagged by all 6 agents |
