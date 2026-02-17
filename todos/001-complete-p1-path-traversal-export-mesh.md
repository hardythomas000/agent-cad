---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, security]
dependencies: []
---

# Path Traversal in export_mesh via Shape ID

## Problem Statement
The `export_mesh` MCP tool uses `entry.id` directly in the filename for STL export. Shape IDs are user-controlled via the `name` parameter on primitive creation tools. A malicious name like `../../etc/malicious` would resolve to a path outside the safe export directory.

## Findings
- **Security Sentinel**: `entry.id` used unescaped in filename (`tools.ts:417`)
- **Architecture Strategist**: Confirmed file path is constructed from user input without sanitization
- Registry `create()` accepts any string as `name` without validation

## Proposed Solutions

### Option A: Sanitize filename (Recommended)
Replace non-alphanumeric chars in shape ID before use in filename.
```typescript
const safeId = entry.id.replace(/[^a-zA-Z0-9_-]/g, '_');
const filename = `${safeId}-${Date.now()}.stl`;
```
- **Pros**: Simple, 1-line fix
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

### Option B: Validate shape names at creation
Reject names containing path separators in `registry.create()`.
- **Pros**: Defense in depth
- **Cons**: More invasive change
- **Effort**: Small
- **Risk**: Low

## Recommended Action
Apply both — sanitize in export AND validate in registry.

## Technical Details
- **Affected files**: `packages/mcp-server/src/tools.ts:417`, `packages/mcp-server/src/registry.ts:27`

## Acceptance Criteria
- [ ] Shape name `../../etc/test` does not write outside TMPDIR/agent-cad/
- [ ] STL files always land in the safe directory
- [ ] Registry rejects names with `/`, `\`, `..`

## Work Log
| Date | Action | Outcome |
|------|--------|---------|
| 2026-02-17 | Identified by Security Sentinel agent | P1 finding |
| 2026-02-18 | Fixed: sanitize filename in tools.ts + validate names in registry.create() | Complete |
