---
status: complete
priority: p3
issue_id: "024"
tags: [code-review, agent-native, named-topology, mcp]
dependencies: []
---

# 024: classify_point Returns Bare Face Name, Not Full Descriptor

## Problem Statement

The `classify_point` MCP tool returns just `{ face: "top" }` (a string or null). The agent typically needs the face normal and kind at that point, requiring a follow-up `query_face` call. Including the full `FaceDescriptor` when face is non-null would save a round-trip tool call.

## Findings

**Source:** Agent-native Reviewer (4)

## Proposed Solutions

### Option A: Include full FaceDescriptor in response (Recommended)
When `classifyPoint` returns a non-null name, also call `face(name)` and include the descriptor.
- **Effort:** Small | **Risk:** None — response payload grows slightly

### Option B: Keep minimal response
Status quo. Agent can call `query_face` if it needs details.
- **Effort:** None | **Risk:** Higher tool-call count for common workflow

## Acceptance Criteria

- [ ] classify_point response includes face descriptor when face is found
- [ ] Response still returns `{ face: null }` when point is not on a face

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Saves agent round-trip |
