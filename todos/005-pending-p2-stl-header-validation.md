---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, data-integrity, quality]
dependencies: []
---

# Missing Validation in exportSTL

## Problem Statement
`exportSTL()` has no guards for: empty mesh (0 triangles), header exceeding 80 bytes when UTF-8 encoded, or degenerate mesh data.

## Findings
- **Architecture Strategist**: No validation on empty mesh or header length
- **Code Quality**: UTF-8 multibyte chars could produce >80 bytes from a short string

## Proposed Solutions

### Option A: Add input guards (Recommended)
```typescript
if (mesh.triangleCount === 0) throw new Error('Cannot export empty mesh');
const headerBytes = enc.encode(header.slice(0, 80));
if (headerBytes.length > 80) throw new Error('STL header too long');
```
- **Effort**: Small

## Acceptance Criteria
- [ ] Empty mesh throws clear error
- [ ] Oversized header throws clear error
- [ ] Add tests for both cases

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-17 | Identified by Architecture + Code Quality agents | P2 finding |
