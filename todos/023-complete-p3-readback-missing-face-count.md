---
status: complete
priority: p3
issue_id: "023"
tags: [code-review, agent-native, named-topology, mcp]
dependencies: []
---

# 023: Standard Readback Missing face_count Hint

## Problem Statement

The `get_shape` MCP tool returns `{ name, bounds, size, center }` but never mentions topology exists. An LLM creating shapes won't know faces are queryable unless it independently calls `query_faces`. Adding `face_count` (a single integer, ~5 tokens) to the standard readback eliminates this "context starvation."

## Findings

**Source:** Agent-native Reviewer (3)

## Proposed Solutions

### Option A: Add face_count to readback (Recommended)
Add `face_count: shape.faces().length` to `get_shape` response.
- **Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] `get_shape` response includes `face_count` integer
- [ ] Existing tool consumers not broken

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Small change, big agent UX improvement |
