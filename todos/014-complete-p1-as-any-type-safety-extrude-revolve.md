---
status: complete
priority: p1
issue_id: "014"
tags: [code-review, typescript, type-safety, named-topology]
dependencies: []
---

# 014: `as any` Type Safety Bypass in Extrude/Revolve Topology

## Problem Statement

Seven `as any` casts in Extrude and Revolve topology methods bypass TypeScript's type system entirely. If any property on `Circle2D` or `Rect2D` is renamed, TypeScript will not report an error — the code will fail at runtime.

## Findings

**Source:** TypeScript Reviewer (C1), Pattern Recognition (2.2), Architecture Strategist (F2), Git History (P2-014)

All three concrete `SDF2D` subclasses already define `readonly kind` as a const literal (`'circle2d'`, `'rect2d'`, `'polygon2d'`), but the abstract base class `SDF2D` lacks the declaration.

Locations in `packages/sdf-kernel/src/sdf.ts`:
- Line 1000: `const p = this.profile as any;` (Extrude.faces)
- Line 1007: access `p.radius` without type checking
- Line 1029: `const prof = this.profile as any;` (Extrude.classifyPoint)
- Line 1030: access `prof.halfW`, `prof.halfH`
- Line 1080: `const p = this.profile as any;` (Revolve.faces)
- Line 1081: access `p.halfW`, `p.halfH`, `p.radius`
- Line 1108: `const prof = this.profile as any;` (Revolve.classifyPoint)

## Proposed Solutions

### Option A: Add `abstract kind` to SDF2D + instanceof narrowing (Recommended)
- Add `abstract readonly kind: string` to `SDF2D` base class in `sdf2d.ts`
- Replace `as any` with `instanceof Circle2D` / `instanceof Rect2D` checks
- **Pros:** Full type safety, compiler catches renames, natural TypeScript pattern
- **Cons:** Requires importing concrete classes into sdf.ts
- **Effort:** Small (30 min)
- **Risk:** Low

### Option B: Add `abstract kind` + use `kind` discriminant directly
- Add `abstract readonly kind: string` to `SDF2D`
- Use `this.profile.kind === 'circle2d'` then `(this.profile as Circle2D).radius`
- **Pros:** Slightly fewer imports, still type-safe after cast
- **Cons:** Still one `as` cast per branch (but typed, not `any`)
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A — `instanceof` gives the cleanest type narrowing with zero casts.

## Technical Details

- **Affected files:** `packages/sdf-kernel/src/sdf.ts`, `packages/sdf-kernel/src/sdf2d.ts`
- **Components:** Extrude.faces(), Extrude.classifyPoint(), Revolve.faces(), Revolve.classifyPoint()

## Acceptance Criteria

- [ ] Zero `as any` casts in sdf.ts
- [ ] `tsc --noEmit` passes with strict mode
- [ ] All 262 tests pass
- [ ] Adding a new SDF2D subclass without implementing topology triggers a type error or falls to freeform default

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-19 | Created | Found by 4 review agents |

## Resources

- `packages/sdf-kernel/src/sdf2d.ts` — SDF2D base class (no `kind` property)
- `packages/sdf-kernel/src/sdf.ts` — Extrude/Revolve classes
