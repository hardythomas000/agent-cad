---
status: complete
priority: p2
issue_id: "011"
tags: [code-review, agent-native, documentation]
dependencies: []
---

# MCP tool descriptions need updating

## Problem Statement
Several tool descriptions are missing information that would help LLM agents use them correctly on the first try, reducing wasted round-trips.

## Findings
- **Agent-Native Reviewer (P2-2)**: The `name` parameter `.describe()` across all 23 tools says only "Optional name for the shape" — it never mentions the character restriction (`[a-zA-Z0-9_-]`). LLMs discover this constraint only at failure time.
- **Agent-Native Reviewer (P2-3)**: Neither `compute_mesh` nor `export_mesh` explains WHY the two-step workflow exists (to inspect mesh stats before committing to export).
- **Agent-Native Reviewer (P2-4)**: `index.ts:6` says "21 callable tools" but there are 23. VISION.md also says "21 tools".
- **Agent-Native Reviewer (P2-1)**: `export_mesh` error message could include a concrete `compute_mesh` call example.

## Proposed Solutions

### Option A: Update all descriptions (Recommended)
1. Change `name` `.describe()` to: "Optional name (letters, digits, hyphens, underscores only)"
2. Update `compute_mesh` description to explain mesh inspection purpose
3. Update `export_mesh` error to include example call
4. Fix tool count to 23
- **Effort**: Small (string changes only)

## Acceptance Criteria
- [ ] `name` parameter descriptions mention character restrictions
- [ ] `compute_mesh` description explains the inspection purpose
- [ ] Tool count is accurate in index.ts and VISION.md
- [ ] Build succeeds

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-18 | Identified by Agent-Native Reviewer | P2 finding |
| 2026-02-18 | Fixed: name param describes char restrictions, compute_mesh explains inspection, export_mesh error has example call, tool count 21→23 | Complete |
