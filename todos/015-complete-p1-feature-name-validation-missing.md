---
status: complete
priority: p1
issue_id: "015"
tags: [code-review, security, named-topology, mcp]
dependencies: []
---

# 015: `feature_name` Parameter Not Validated on MCP Boolean Tools

## Problem Statement

The `feature_name` parameter on `boolean_union`, `boolean_subtract`, and `boolean_intersect` MCP tools is declared as bare `z.string().optional()` with no format or length constraint. It flows directly into face name composition: `${featureName}.${faceName}`. Meanwhile, shape `name` IS validated with `/^[a-zA-Z0-9_-]+$/` in `registry.ts`. This gap allows injection of arbitrary strings (megabyte lengths, dots creating ambiguous hierarchies, newlines, null bytes) into face names returned from `query_faces` and `query_face`.

## Findings

**Source:** Security Sentinel (F1)

Locations in `packages/mcp-server/src/tools.ts`:
- Line 232: `feature_name: z.string().optional()` on `boolean_union`
- Line 253: `feature_name: z.string().optional()` on `boolean_subtract`
- Line 274: `feature_name: z.string().optional()` on `boolean_intersect`

Existing validation pattern in `packages/mcp-server/src/registry.ts` line 29:
```typescript
if (name !== undefined && !/^[a-zA-Z0-9_-]+$/.test(name)) {
  throw new Error('Invalid shape name...');
}
```

## Proposed Solutions

### Option A: Zod schema validation (Recommended)
Add to all three boolean tool definitions:
```typescript
feature_name: z.string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .max(64)
  .optional()
  .describe('...')
```
- **Pros:** Validates at tool boundary, consistent with `name` validation, prevents injection
- **Cons:** None
- **Effort:** Small (5 min, ~6 lines changed)
- **Risk:** None

## Recommended Action

Option A — one-word additions per parameter.

## Acceptance Criteria

- [ ] `feature_name` rejects strings with dots, spaces, special characters
- [ ] `feature_name` rejects strings > 64 characters
- [ ] All existing tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Security sentinel finding |
