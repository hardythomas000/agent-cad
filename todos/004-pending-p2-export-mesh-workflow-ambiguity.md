---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, agent-native]
dependencies: []
---

# export_mesh Auto-Compute Undermines Two-Step Workflow

## Problem Statement
`export_mesh` description says "Call compute_mesh first" but silently auto-computes if no mesh is cached. LLM agents will skip `compute_mesh` entirely, missing the opportunity to review mesh stats before export.

## Findings
- **Agent-Native Reviewer**: export_mesh falls back to auto-compute (tools.ts:407-411), making compute_mesh optional despite the description
- Description is misleading — either enforce the dependency or be honest about auto-compute

## Proposed Solutions

### Option A: Enforce dependency — throw if no cached mesh
```typescript
if (!mesh) {
  throw new Error('No mesh cached for "' + shape + '". Call compute_mesh first.');
}
```
- **Effort**: Small
- **Risk**: Breaking change if agents rely on auto-compute

### Option B: Update description to reflect reality
Change to: "Export as STL. Uses cached mesh if available, or auto-computes at given resolution."
- **Effort**: Trivial

## Acceptance Criteria
- [ ] Workflow is clearly documented in tool descriptions
- [ ] LLM knows whether compute_mesh is required or optional

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-17 | Identified by Agent-Native Reviewer | P2 finding |
