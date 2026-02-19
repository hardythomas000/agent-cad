---
title: Toolpath Visualization in Viewer
type: feat
date: 2026-02-19
status: reviewed
---

# feat: Toolpath Visualization in Viewer

## Overview

Add toolpath rendering to the Agent CAD viewer so cut paths are drawn as colored lines over the mesh. Currently, `generate_surfacing_toolpath` produces data that only exists as G-code output — there's no visual feedback. This feature closes the loop: you see the toolpath overlaid on the part, colored by move type.

## Problem Statement

When the LLM (or user) generates a surfacing toolpath via MCP or the editor DSL, the only output is a `.nc` file. There's no way to visually verify the toolpath makes sense — rapids clear the part, cuts follow the surface, stepover spacing looks right. This is the CAM equivalent of "printf debugging" when you could have a debugger.

## Proposed Solution

Add toolpath visualization to the viewer through two parallel paths:

1. **Editor DSL** — new `defineTool()` and `showToolpath()` functions in the kernel-bridge, so users can write toolpath code directly in the editor and see it rendered live.
2. **Scene integration** — a new `toolpathGroup` in the Three.js scene with a toolbar toggle, following the exact same pattern as `modelGroup` / `edgeGroup` / `wireGroup`.

### Color Scheme (hardcoded — CAM conventions, not theme-dependent)

| Move Type | Color | Hex |
|-----------|-------|-----|
| Rapid (G00) | Red | `0xe06060` |
| Cut (G01) | Teal | `0x4a9e8e` |
| Plunge | Gold | `0xc9a84c` |

All solid lines. No dashing for v1 — color alone is sufficient to distinguish move types. Dashing can be added in v2 if needed.

### Design Decisions (from review)

- **Single geometry with vertex colors** — one `LineSegments` + one `LineBasicMaterial({ vertexColors: true })` instead of 3 separate geometries. Fewer draw calls, simpler disposal.
- **Module-level stashing** — toolpath result stored as `let toolpathVisual` in kernel-bridge (same pattern as `meshResult`), NOT bolted onto `ExecuteSuccess`.
- **Flat structure** — `LineSegments` added directly to `ctx.toolpathGroup`, not nested in a sub-group. Avoids GPU leak in existing `disposeGroup()`.
- **Hardcoded colors** — toolpath colors don't change with dark/light theme. Red rapids, teal cuts, gold plunges are CAM conventions.
- **No status bar changes** — toolpath lines on screen are the visual feedback. Stats logged to console.
- **Default editor code unchanged** — keep the simple plate+drills example.

## Technical Approach

### New Files

#### `packages/viewer/src/toolpath-renderer.ts`

Converts `ToolpathResult` → single `THREE.LineSegments` with vertex colors:

```typescript
import * as THREE from 'three';
import type { ToolpathResult } from '@agent-cad/sdf-kernel';

const COLORS = {
  rapid:  new THREE.Color(0xe06060),
  cut:    new THREE.Color(0x4a9e8e),
  plunge: new THREE.Color(0xc9a84c),
};

export function renderToolpath(toolpath: ToolpathResult): THREE.LineSegments {
  // 1. Count segments (points.length - 1, skipping any with identical positions)
  // 2. Pre-allocate Float32Array for positions (segCount * 6) and colors (segCount * 6)
  // 3. Walk points pairwise: push [prev.xyz, curr.xyz] to positions,
  //    push [color, color] to colors based on curr.type
  // 4. Build BufferGeometry with position + color attributes
  // 5. Return LineSegments with LineBasicMaterial({ vertexColors: true })
}
```

Returns a single `THREE.LineSegments` — no wrapper types, no stats object (caller already has `ToolpathResult.stats`).

### Modified Files

#### `packages/viewer/src/scene.ts`

- Add `toolpathGroup: THREE.Group` to `SceneContext`

```typescript
// In SceneContext interface:
toolpathGroup: THREE.Group;

// In initScene():
const toolpathGroup = new THREE.Group();
scene.add(toolpathGroup);
```

#### `packages/viewer/src/kernel-bridge.ts`

Add `defineTool()` and `showToolpath()` DSL functions. Use module-level stashing (same pattern as `meshResult`):

```typescript
import { generateRasterSurfacing, type ToolDefinition } from '@agent-cad/sdf-kernel';
import { renderToolpath } from './toolpath-renderer.js';

let toolpathVisual: THREE.LineSegments | null = null;

// Inside executeCode():
toolpathVisual = null;  // Reset each execution

const defineTool = (opts: { type: 'ballnose', diameter: number, ... }) => {
  return { ...opts, name: 'tool', radius: opts.diameter / 2 } as ToolDefinition;
};

const showToolpath = (shape: SDF, tool: ToolDefinition, params: ToolpathParams) => {
  const tp = generateRasterSurfacing(shape, tool, { ...params, id: 'live' });
  toolpathVisual = renderToolpath({ ...tp, id: 'live' });
  console.log('Toolpath:', tp.stats);
};

// After execution, export getter:
export function getToolpathVisual(): THREE.LineSegments | null {
  return toolpathVisual;
}
```

`ExecuteSuccess` is NOT modified — toolpath state is independent of mesh state.

#### `packages/viewer/src/main.ts`

- After `displayGeometry()`, check `getToolpathVisual()` and add to `toolpathGroup`
- Dispose `toolpathGroup` at the top of every render cycle (same as other groups)
- Add toolbar toggle handler for `case 'toolpath'` in the existing switch

```typescript
// In runCode():
const result = executeCode(code);
if (isError(result)) {
  showError(result.error);
  disposeGroup(ctx.toolpathGroup);  // Clear toolpath on error too
} else {
  displayGeometry(result);
  // Handle toolpath separately
  disposeGroup(ctx.toolpathGroup);
  const tpVisual = getToolpathVisual();
  if (tpVisual) {
    ctx.toolpathGroup.add(tpVisual);
  }
}
```

#### `packages/viewer/index.html`

Add toggle button to the display toolbar group:

```html
<button class="toolbar-btn" data-toggle="toolpath">Path</button>
```

Label is "Path" (not "TP" — matches readability of other buttons).

### Data Flow

```
Editor DSL code
  → kernel-bridge.executeCode()
    → defineTool() creates ToolDefinition
    → showToolpath(shape, tool, params)
      → generateRasterSurfacing()  [from sdf-kernel]
      → renderToolpath()  [new module → THREE.LineSegments]
      → stores in module-level toolpathVisual
    → returns mesh result (unchanged)
  → main.ts runCode()
    → displayGeometry(result)  [mesh, unchanged]
    → getToolpathVisual()  [separate path]
    → adds LineSegments to ctx.toolpathGroup
```

### Editor DSL Example

```javascript
// Agent CAD — toolpath visualization demo
const plate = box(150, 20, 80)
const drill = cylinder(5, 30).rotateX(90)

const shape = plate
  .subtract(drill.translate(50, 0, 0))
  .subtract(drill.translate(-50, 0, 0))

computeMesh(shape, 1.0)

const tool = defineTool({ type: 'ballnose', diameter: 12 })
showToolpath(shape, tool, {
  feed_rate: 2000,
  rpm: 10000,
  safe_z: 50,
  stepover_pct: 15,
  direction: 'x'
})
```

## Acceptance Criteria

- [ ] Toolpath renders as colored lines overlaid on the mesh in the viewer
- [ ] Rapids (red), cuts (teal), plunges (gold) are visually distinct via vertex colors
- [ ] Toolbar "Path" button toggles toolpath visibility on/off
- [ ] `defineTool()` and `showToolpath()` DSL functions work in the editor
- [ ] Toolpath clears and re-renders when code changes (same lifecycle as mesh)
- [ ] Removing `showToolpath()` from code clears the toolpath (no stale lines)
- [ ] GPU resources (geometry + material) properly disposed on each re-render
- [ ] No regression on existing viewer features (STL loading, display modes, themes)
- [ ] Toolpath stats logged to console on generation

## Implementation Phases

### Phase 1: Renderer module
Create `toolpath-renderer.ts` — pure function: `ToolpathResult` → `THREE.LineSegments` with vertex colors. Pre-allocate `Float32Array` buffers.

### Phase 2: Scene integration
Add `toolpathGroup` to `SceneContext` in `scene.ts`. Add "Path" toggle button to `index.html`. Add `case 'toolpath'` to the toggle switch in `main.ts`.

### Phase 3: Kernel bridge
Add `defineTool()`, `showToolpath()`, and `getToolpathVisual()` to `kernel-bridge.ts`. Module-level stashing pattern. Add required imports from sdf-kernel.

### Phase 4: Main integration
Wire `runCode()` in `main.ts` to call `getToolpathVisual()` after `displayGeometry()`, add result to `toolpathGroup`, dispose on each cycle.

### Phase 5: Test & verify
Test with the DSL example above. Verify: colors correct, toggle works, disposal works (edit code to remove showToolpath, verify lines disappear), no console errors.

## Dependencies & Risks

- **`generateRasterSurfacing()` performance** — runs drop cutter per grid point synchronously. For a 150x80mm part at 15% stepover on 12mm ball nose: ~3,600 SDF evaluations, should be fine. Larger parts with finer stepover will freeze the UI. For v1 this is acceptable — the DSL is opt-in. Future: Web Worker.
- **`lineWidth` capped at 1px** in WebGL on most browsers. Fine for v1 — toolpath lines at 1px are standard. Fat lines (THREE.Line2) could be a v2 enhancement.
- **No kernel changes required** — `ToolpathResult` and `generateRasterSurfacing` already export everything needed.

## References

- [toolpath.ts](packages/sdf-kernel/src/toolpath.ts) — `ToolpathResult`, `ToolpathPoint`, `generateRasterSurfacing()`
- [kernel-bridge.ts](packages/viewer/src/kernel-bridge.ts) — DSL execution sandbox, `meshResult` stashing pattern
- [scene.ts](packages/viewer/src/scene.ts) — `SceneContext`, group pattern
- [main.ts](packages/viewer/src/main.ts) — display/dispose lifecycle, toolbar toggle switch
- [theme.ts](packages/viewer/src/theme.ts) — `HEX` colors (toolpath colors intentionally NOT in here)
