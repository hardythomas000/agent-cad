---
status: complete
priority: p2
issue_id: "020"
tags: [code-review, performance, named-topology]
dependencies: []
---

# 020: face() Calls faces() Twice on Error Path

## Problem Statement

`SDF.face(name)` at line 213 of `sdf.ts` calls `this.faces()` once to search, then calls it again on the error path to build the error message. On complex models, `faces()` walks the entire SDF tree. This doubles the cost on lookup failure.

## Findings

**Source:** TypeScript Reviewer (Finding 6), Security Sentinel (F5), Performance Oracle (3.1), Architecture Strategist (F6)

## Proposed Solutions

### Option A: Cache in local variable (Recommended)
```typescript
face(name: string): FaceDescriptor {
    const all = this.faces();
    const f = all.find(fd => fd.name === name);
    if (!f) {
        throw new Error(`Face "${name}" not found. Available: [${all.map(fd => fd.name).join(', ')}]`);
    }
    return f;
}
```
- **Effort:** Trivial (2 min, 3 lines) | **Risk:** None

## Acceptance Criteria

- [ ] `this.faces()` called exactly once per `face()` invocation
- [ ] Error message still lists available names
- [ ] All tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Trivial fix flagged by 4 agents |
