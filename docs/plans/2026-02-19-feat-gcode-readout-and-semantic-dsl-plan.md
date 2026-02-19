---
title: G-code Readout Panel + Semantic DSL (hole)
type: feat
date: 2026-02-19
status: reviewed
---

# feat: G-code Readout Panel + Semantic hole()

## Overview

Two features that push agent-cad toward its VISION.md endgame: **transparent post-processing** and **intent-based modeling**.

1. **G-code Readout** — when `showToolpath()` runs, display the generated Fanuc G-code in a `<pre>` below the editor. Auto-shows when G-code exists, auto-hides when it doesn't. No separate module — inline in main.ts.

2. **Semantic `hole()`** — `hole(shape, "top", { diameter: 10, depth: "through" })` resolves face topology to auto-orient and position a hole. Replaces manual `cylinder().rotateX().translate()` chains. `pocket()` deferred to v2.

### Design Decisions (from review)

- **No syntax highlighting** — plain `textContent` in a `<pre>`. Machinists read raw G-code all day.
- **No copy/download buttons for v1** — Ctrl+A/Ctrl+C works. Add convenience buttons later if requested.
- **No toolbar toggle for v1** — auto-show/hide only. Panel appears when G-code exists.
- **No `gcode-panel.ts` module** — ~10 lines of inline code in main.ts, not a new file.
- **No `pocket()` in v1** — `hole()` alone proves the semantic DSL concept. `pocket()` comes later.
- **`diameter` not `dia`** — consistency with kernel API and ToolDefinition.
- **3D offset, not 2D** — `at: [x, y, z]` instead of face-relative 2D. Kernel projects onto face plane, dropping the normal component. No axis-mapping convention to learn.
- **6-case lookup for orientation** — explicit switch on cardinal directions, not general Rodrigues rotation. Throws on non-axis-aligned normals.
- **Derive feature names from shape** — count existing `hole_N` faces instead of global counters. No `resetFeatureCounters()`.
- **Cylinder offset fix** — translate inward by `holeDepth/2` from face origin so hole fully penetrates.
- **Validate depth > 0** — throw on non-positive depth.

## Technical Approach

### Phase 1: G-code Readout

#### Modified: `packages/viewer/src/kernel-bridge.ts`

Import `emitFanucGCode`. In `_showToolpath()`, after generating the toolpath, call it and stash:

```typescript
import { emitFanucGCode } from '@agent-cad/sdf-kernel';

let gcodeText: string | null = null;

export function getGCodeText(): string | null {
  return gcodeText;
}

// Inside executeCode():
gcodeText = null;  // Reset each execution

// Inside _showToolpath(), after generating tp:
gcodeText = emitFanucGCode({ ...tp, id: 'live' });
```

No double-defaulting of GCodeConfig — let `emitFanucGCode` use its own defaults.

#### Modified: `packages/viewer/index.html`

Add `<pre id="gcode-content">` inside `#editor-pane`, below `#editor-error`:

```html
<pre id="gcode-content"></pre>
```

CSS:

```css
#gcode-content {
  flex: 0 0 0;
  overflow: auto;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text);
  margin: 0;
  white-space: pre;
  border-top: 1px solid var(--border);
  max-height: 35%;
  display: none;
}

#gcode-content.visible {
  display: block;
  flex: 0 0 auto;
}
```

#### Modified: `packages/viewer/src/main.ts`

After `getToolpathVisual()`, update the G-code panel:

```typescript
const gcodeContent = document.getElementById('gcode-content')!;

// In runCode(), after toolpath handling:
const gcodeText = getGCodeText();
if (gcodeText) {
  gcodeContent.textContent = gcodeText;
  gcodeContent.classList.add('visible');
} else {
  gcodeContent.textContent = '';
  gcodeContent.classList.remove('visible');
}
```

### Phase 2: Semantic hole()

#### New: `packages/sdf-kernel/src/features.ts`

```typescript
import { SDF, Cylinder } from './sdf.js';
import type { Vec3 } from './vec3.js';

export interface HoleOptions {
  diameter: number;
  depth: number | 'through';
  at?: Vec3;              // 3D offset from face center (normal component dropped)
  featureName?: string;   // default: auto "hole_N" derived from shape
}

/**
 * Create a hole on a named planar face.
 * Returns a new SDF with the hole subtracted.
 */
export function hole(shape: SDF, faceName: string, opts: HoleOptions): SDF {
  const face = shape.face(faceName);

  if (face.kind !== 'planar') {
    const planarFaces = shape.faces().filter(f => f.kind === 'planar').map(f => f.name);
    throw new Error(
      `hole() requires a planar face, but "${faceName}" is ${face.kind}. ` +
      `Available planar faces: [${planarFaces.join(', ')}]`
    );
  }

  // Validate depth
  if (typeof opts.depth === 'number' && opts.depth <= 0) {
    throw new Error(`hole() depth must be positive, got ${opts.depth}`);
  }

  // Resolve depth
  let holeDepth: number;
  if (opts.depth === 'through') {
    const bounds = shape.bounds();
    const n = face.normal;
    const extent = Math.abs(
      (bounds.max[0] - bounds.min[0]) * n[0] +
      (bounds.max[1] - bounds.min[1]) * n[1] +
      (bounds.max[2] - bounds.min[2]) * n[2]
    );
    holeDepth = extent + 1; // 1mm clearance
  } else {
    holeDepth = opts.depth;
  }

  // Create cylinder
  const cyl = new Cylinder(opts.diameter / 2, holeDepth);

  // Orient to face normal (6-case lookup for axis-aligned faces)
  const inward: Vec3 = [-face.normal[0], -face.normal[1], -face.normal[2]];
  const oriented = orientToAxis(cyl, inward);

  // Position: face origin + inward offset of holeDepth/2
  const center = face.origin ?? [0, 0, 0];
  const inwardOffset = holeDepth / 2;
  let positioned = oriented.translate(
    center[0] + inward[0] * inwardOffset,
    center[1] + inward[1] * inwardOffset,
    center[2] + inward[2] * inwardOffset,
  );

  // Apply 3D offset (projected onto face plane by dropping normal component)
  if (opts.at) {
    const n = face.normal;
    const dot = opts.at[0] * n[0] + opts.at[1] * n[1] + opts.at[2] * n[2];
    positioned = positioned.translate(
      opts.at[0] - dot * n[0],
      opts.at[1] - dot * n[1],
      opts.at[2] - dot * n[2],
    );
  }

  // Derive feature name from existing faces
  const featureName = opts.featureName ?? nextFeatureName(shape, 'hole');
  return shape.subtract(positioned, featureName);
}

/** Count existing hole_N faces to derive next name. */
function nextFeatureName(shape: SDF, prefix: string): string {
  const existing = shape.faces().filter(f => f.name.startsWith(`${prefix}_`));
  return `${prefix}_${existing.length + 1}`;
}

/**
 * Orient an SDF from Z-axis to a cardinal direction.
 * 6-case lookup — throws on non-axis-aligned normals.
 */
function orientToAxis(shape: SDF, normal: Vec3): SDF {
  const [nx, ny, nz] = normal;
  if (Math.abs(nz - 1) < 1e-9) return shape;                // +Z (no rotation)
  if (Math.abs(nz + 1) < 1e-9) return shape.rotateX(180);   // -Z
  if (Math.abs(ny - 1) < 1e-9) return shape.rotateX(-90);   // +Y
  if (Math.abs(ny + 1) < 1e-9) return shape.rotateX(90);    // -Y
  if (Math.abs(nx - 1) < 1e-9) return shape.rotateY(90);    // +X
  if (Math.abs(nx + 1) < 1e-9) return shape.rotateY(-90);   // -X
  throw new Error(
    `hole() only supports axis-aligned faces in v1. ` +
    `Normal [${nx}, ${ny}, ${nz}] is not axis-aligned.`
  );
}
```

#### Modified: `packages/sdf-kernel/src/index.ts`

```typescript
// Feature constructors (semantic DSL)
export { hole } from './features.js';
export type { HoleOptions } from './features.js';
```

#### Modified: `packages/viewer/src/kernel-bridge.ts`

Inject `hole()` into the DSL sandbox:

```typescript
import { hole, type HoleOptions } from '@agent-cad/sdf-kernel';

// Add to new Function() parameter list and call:
const _hole = (shape: SDF, face: string, opts: HoleOptions) => track(hole(shape, face, opts));
```

### Data Flow

```
G-code:
  showToolpath() → generateRasterSurfacing() → emitFanucGCode() → gcodeText
  main.ts runCode() → getGCodeText() → gcodeContent.textContent

hole():
  hole(shape, "top", opts)
    → shape.face("top")           [FaceDescriptor]
    → resolve depth               [AABB + clearance]
    → Cylinder(r, h)              [along Z]
    → orientToAxis(cyl, inward)   [6-case rotation]
    → translate(center + offset)  [face origin + inward + at]
    → shape.subtract(cyl, name)   [feature named "hole_N"]
```

## Acceptance Criteria

### G-code Readout
- [ ] `<pre>` panel appears below editor when `showToolpath()` runs
- [ ] G-code matches `emitFanucGCode()` output
- [ ] Panel auto-hides when G-code is null
- [ ] Panel updates on each debounced re-execution
- [ ] Respects dark/light theme via CSS variables

### Semantic hole()
- [ ] `hole(shape, "top", { diameter: 10, depth: "through" })` — centered through-hole
- [ ] `hole(shape, "top", { diameter: 10, depth: 20, at: [30, 0, 0] })` — offset blind hole
- [ ] Works on all 6 box faces: top, bottom, left, right, front, back
- [ ] Auto-orients cylinder to face normal
- [ ] Through-hole fully penetrates (cylinder offset inward by holeDepth/2)
- [ ] Rejects non-planar faces with helpful error listing available planar faces
- [ ] Rejects non-existent faces with error listing available faces
- [ ] Validates depth > 0
- [ ] Feature names derived from shape: `hole_1`, `hole_2`, ...
- [ ] Named faces survive: `shape.face("hole_1.barrel")` works
- [ ] Works in viewer DSL
- [ ] Tests for all 6 faces, through/blind, with/without offset

## Implementation Phases

### Phase 1: G-code Readout
- kernel-bridge.ts: import `emitFanucGCode`, call in `_showToolpath`, stash `gcodeText`, export `getGCodeText()`
- index.html: add `<pre id="gcode-content">` with CSS
- main.ts: ~5 lines to populate and toggle visibility

### Phase 2: Semantic hole()
- features.ts (new): `hole()`, `orientToAxis()`, `nextFeatureName()`
- index.ts: export `hole`, `HoleOptions`
- kernel-bridge.ts: inject `_hole` into sandbox
- tests: all 6 faces, through/blind, offset, error cases

## References

- [gcode.ts](packages/sdf-kernel/src/gcode.ts) — `emitFanucGCode()`
- [topology.ts](packages/sdf-kernel/src/topology.ts) — `FaceDescriptor`
- [sdf.ts](packages/sdf-kernel/src/sdf.ts) — `.face()`, `.faces()`, `.bounds()`
- [kernel-bridge.ts](packages/viewer/src/kernel-bridge.ts) — DSL sandbox pattern
- [main.ts](packages/viewer/src/main.ts) — viewer display lifecycle
- [VISION.md](VISION.md) — DSL vision, Killer Feature #3
