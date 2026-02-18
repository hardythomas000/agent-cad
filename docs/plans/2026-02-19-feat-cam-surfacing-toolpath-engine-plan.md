---
title: "feat: 3-Axis Ball Nose Surface Finishing Toolpath Engine"
type: feat
date: 2026-02-19
phase: 5
brainstorm: docs/brainstorms/2026-02-19-cam-toolpath-engine-brainstorm.md
---

# 3-Axis Ball Nose Surface Finishing Toolpath Engine

## Overview

Add a CAM toolpath engine to agent-cad that generates 3-axis ball nose surface finishing toolpaths directly from SDF geometry via drop cutter — no mesh intermediary. The AI agent defines a tool, selects a shape, configures parameters, and gets Fanuc-compatible G-code output. This is Phase 5 of the agent-cad roadmap.

## Problem Statement

The SDF kernel can model geometry and export meshes, but cannot produce CNC toolpaths. The `dropCutter()` method already finds Z-contact with sub-micron precision — the missing piece is the grid-walking strategy, tool offset geometry, and G-code emission. This phase bridges the gap from "geometry you can look at" to "geometry you can cut."

## Proposed Solution

Three new MCP tools forming a complete CAM workflow:

```
define_tool → generate_surfacing_toolpath → export_gcode
```

Drop cutter operates on an SDF offset by the ball nose radius (via `Round` node), producing a Z-map that gets serialized as linear G01 moves in Fanuc G-code.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  MCP Server (tools.ts or cam-tools.ts)              │
│  ┌──────────┐  ┌────────────────────┐  ┌──────────┐│
│  │define_tool│  │generate_surfacing_ │  │export_   ││
│  │          │  │toolpath            │  │gcode     ││
│  └────┬─────┘  └────────┬───────────┘  └────┬─────┘│
│       │                 │                    │      │
│  ┌────▼─────────────────▼────────────────────▼─────┐│
│  │              Registry (extended)                 ││
│  │  shapes: Map<string, ShapeEntry>                 ││
│  │  tools:  Map<string, ToolDefinition>    (NEW)    ││
│  │  paths:  Map<string, ToolpathResult>    (NEW)    ││
│  └──────────────────────┬──────────────────────────┘│
└─────────────────────────┼───────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────┐
│  SDF Kernel                                         │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐│
│  │toolpath.ts│  │gcode.ts      │  │sdf.ts          ││
│  │(NEW)     │  │(NEW)         │  │(existing)      ││
│  │          │  │              │  │                ││
│  │Raster    │  │FanucEmitter  │  │.round(R)       ││
│  │Strategy  │  │G00/G01/M-cod│  │.dropCutter()   ││
│  └──────────┘  └──────────────┘  └────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Claude: define_tool({ type: "ballnose", diameter: 12, name: "T1" })
   → stores ToolDefinition in registry, returns readback

2. Claude: generate_surfacing_toolpath({
     shape: "my_part",
     tool: "T1",
     direction: "x",
     stepover_pct: 10,
     feed_rate: 2000,
     rpm: 10000,
     safe_z: 50
   })
   → internally:
     a. Get shape SDF from registry
     b. Get tool from registry → ball nose radius R = diameter/2
     c. Create offset SDF: shape.round(R)
     d. Compute shape bounds for grid extents
     e. Walk parallel raster lines (X direction):
        for each Y line (spaced by stepover):
          for each X point (spaced by point_spacing):
            z_center = offsetShape.dropCutter(x, y, zTop, zBottom)
            z_tip = z_center - R
            emit toolpath point {x, y, z: z_tip}
     f. Add safe Z retracts between passes
     g. Store ToolpathResult in registry
   → returns { toolpath_id, type, readback: { point_count, z_range, estimated_time, passes } }

3. Claude: export_gcode({ toolpath: "tp_1", program_number: 1001 })
   → reads ToolpathResult from registry
   → emits Fanuc G-code to file
   → returns { file_path, line_count, estimated_cycle_time }
```

### Ball Nose Contact Geometry

```
For ball nose radius R at grid point (x, y):

              ┌─── tool shank
              │
         ╭────┴────╮
         │  R      │  ← ball nose (sphere of radius R)
         │    ●    │  ← ball center at z_center
         ╰────┬────╯
              │
    ──────────┼──────── z_tip = z_center - R (G-code programs tip)
              │
     ╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱  ← part surface

Offset approach:
  offset_sdf = shape.round(R)     // expand surface outward by R
  z_center = offset_sdf.dropCutter(x, y, zTop, zBottom)  // ball center Z
  z_tip = z_center - R            // tool tip Z for G-code

Why this works:
  .round(R) subtracts R from the SDF → isosurface moves outward by R
  Drop cutter on offset SDF finds where ball CENTER contacts
  Subtract R to get where ball TIP would be
  This is geometrically exact for any surface curvature
```

**Important validation:** The `Round` class (`sdf.ts:568-575`) computes `child.evaluate(p) - radius`. With positive R, this shrinks the SDF value → surface moves outward. This is correct for ball nose offset. No code changes needed to `Round`.

### Raster Pattern

```
Zigzag (default):                    Unidirectional:

  ──→──→──→──→──→  Y=y_max          ──→──→──→──→──→  Y=y_max
  ←──←──←──←──←──  Y=y_max-step       ──→──→──→──→──→  Y=y_max-step
  ──→──→──→──→──→  Y=y_max-2*step     ──→──→──→──→──→  Y=y_max-2*step
  ←──←──←──←──←──  ...                ──→──→──→──→──→  ...
  ──→──→──→──→──→  Y=y_min            ──→──→──→──→──→  Y=y_min

  Zigzag: no retract between passes (faster)
  Unidirectional: retract + rapid to start of next pass (better finish)
```

### G-code Output Format

```gcode
%
O1001 (BALL NOSE SURFACING)
(TOOL: T1 D12.0 BALL NOSE)
(SHAPE: my_part)
(GENERATED: 2026-02-19 BY AGENT-CAD)
(STEPOVER: 1.2MM  FEED: 2000MM/MIN  RPM: 10000)
G90 G21 G17 (ABSOLUTE, METRIC, XY PLANE)
G00 G54 X0. Y0. Z50. (RAPID TO SAFE Z)
M03 S10000 (SPINDLE ON)
G00 X-50. Y30. (RAPID TO FIRST PASS START)
G00 Z5. (RAPID APPROACH)
G01 Z-2.345 F500 (PLUNGE TO FIRST CUT)
G01 X-49. Z-2.401 F2000 (CUTTING)
G01 X-48. Z-2.523
G01 X-47. Z-2.712
...
G01 X50. Z-1.890
G00 Z50. (RETRACT)
G00 Y28.8 (STEP TO NEXT PASS)
G00 Z5. (APPROACH)
G01 Z-2.156 F500
...
M05 (SPINDLE OFF)
M09 (COOLANT OFF)
G00 G53 Z0. (HOME Z)
M30 (END)
%
```

## New Files

### `packages/sdf-kernel/src/toolpath.ts` (~200 lines)

```typescript
// Type definitions
export interface ToolDefinition {
  name: string;
  type: 'ballnose';           // extensible to 'flat' | 'bullnose' later
  diameter: number;            // mm
  radius: number;              // diameter / 2 (computed)
  flute_length?: number;       // mm
  shank_diameter?: number;     // mm
}

export interface ToolpathPoint {
  x: number;
  y: number;
  z: number;
  type: 'rapid' | 'cut' | 'plunge';
}

export interface ToolpathParams {
  direction: 'x' | 'y';       // raster direction
  stepover_pct: number;        // % of tool diameter (e.g. 10 = 10%)
  point_spacing?: number;      // mm along cut direction (default: stepover)
  feed_rate: number;           // mm/min
  plunge_rate?: number;        // mm/min (default: feed_rate / 3)
  rpm: number;
  safe_z: number;              // mm (retract height)
  approach_z?: number;         // mm (rapid approach before plunge, default: 5)
  z_top?: number;              // search start (default: shape bounds max Z + 10)
  z_bottom?: number;           // search end (default: shape bounds min Z - 5)
  zigzag?: boolean;            // true = zigzag, false = unidirectional (default: true)
  boundary_overcut?: number;   // mm to extend past shape bounds (default: tool radius)
}

export interface ToolpathResult {
  id: string;
  tool: ToolDefinition;
  params: ToolpathParams;
  points: ToolpathPoint[];
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] };
  stats: {
    point_count: number;
    pass_count: number;
    cut_distance_mm: number;
    rapid_distance_mm: number;
    estimated_time_min: number;   // (cut_distance/feed + rapid_distance/rapid_rate)
    z_min: number;
    z_max: number;
  };
}

// Core algorithm
export function generateRasterSurfacing(
  shape: SDF,
  tool: ToolDefinition,
  params: ToolpathParams
): ToolpathResult;
```

**Algorithm pseudocode for `generateRasterSurfacing`:**

```
function generateRasterSurfacing(shape, tool, params):
  R = tool.radius
  offsetShape = new Round(shape, R)  // expand surface by ball nose radius
  bounds = shape.bounds()

  // Grid extents with boundary overcut
  overcut = params.boundary_overcut ?? R
  x_min = bounds.min[0] - overcut
  x_max = bounds.max[0] + overcut
  y_min = bounds.min[1] - overcut
  y_max = bounds.max[1] + overcut

  stepover = tool.diameter * (params.stepover_pct / 100)
  spacing = params.point_spacing ?? stepover

  z_top = params.z_top ?? bounds.max[2] + 10
  z_bottom = params.z_bottom ?? bounds.min[2] - 5

  points = []
  pass_index = 0

  if direction == 'x':
    // Walk Y passes, cut along X
    for y = y_min to y_max step stepover:
      reverse = params.zigzag && (pass_index % 2 == 1)
      x_start = reverse ? x_max : x_min
      x_end = reverse ? x_min : x_max
      x_step = reverse ? -spacing : spacing

      // Retract → rapid to start → approach
      points.push({ x: x_start, y, z: safe_z, type: 'rapid' })

      first_cut = true
      for x = x_start to x_end step x_step:
        z_center = offsetShape.dropCutter(x, y, z_top, z_bottom)
        if z_center == null:
          continue  // no surface at this point (air cut region)
        z_tip = z_center - R

        if first_cut:
          points.push({ x, y, z: approach_z, type: 'rapid' })
          points.push({ x, y, z: z_tip, type: 'plunge' })
          first_cut = false
        else:
          points.push({ x, y, z: z_tip, type: 'cut' })

      // Retract at end of pass
      points.push({ x: x_end, y, z: safe_z, type: 'rapid' })
      pass_index++

  // Compute stats
  return { points, stats: computeStats(points, params) }
```

### `packages/sdf-kernel/src/gcode.ts` (~150 lines)

```typescript
export interface GCodeConfig {
  program_number?: number;      // O-number (default: 1001)
  work_offset?: string;         // G54, G55, etc. (default: G54)
  coolant?: 'flood' | 'mist' | 'off';  // M08, M07, M09
  comment_style?: 'paren' | 'semicolon';  // (comment) vs ;comment
  decimal_places?: number;      // coordinate precision (default: 3)
  line_numbers?: boolean;       // N-numbers (default: false)
  rapid_rate?: number;          // mm/min for time estimation (default: 15000)
}

export function emitFanucGCode(
  toolpath: ToolpathResult,
  config?: GCodeConfig
): string;

// Returns the full G-code program as a string.
// Handles:
//  - Header: %, O-number, comments, G90 G21 G17
//  - Tool call: T1 M06 (optional, configurable)
//  - Spindle: M03 S<rpm>
//  - Coolant: M08/M07/M09
//  - Body: G00 for rapids, G01 for cuts with F-word
//  - Modal optimization: only emit changed coordinates
//  - Retract: G00 Z<safe_z> between passes
//  - Footer: M05, M09, G00 G53 Z0., M30, %
```

**Modal optimization detail:**

```gcode
// WITHOUT modal optimization (verbose):
G01 X10.000 Y20.000 Z-5.123 F2000
G01 X11.000 Y20.000 Z-5.234 F2000
G01 X12.000 Y20.000 Z-5.345 F2000

// WITH modal optimization (what we emit):
G01 X10. Y20. Z-5.123 F2000
X11. Z-5.234
X12. Z-5.345

// Y doesn't change → omit. F already set → omit. G01 modal → omit.
// Saves ~40% file size on typical surfacing programs.
```

## Modified Files

### `packages/mcp-server/src/registry.ts`

**Changes:**
- Add `ToolDefinition` storage: `tools: Map<string, ToolDefinition>`
- Add `ToolpathResult` storage: `toolpaths: Map<string, ToolpathResult>`
- New methods:
  - `createTool(tool: ToolDefinition, name?: string): ToolResult`
  - `getTool(id: string): ToolDefinition`
  - `listTools(): ToolResult[]`
  - `createToolpath(toolpath: ToolpathResult, name?: string): ToolpathSummary`
  - `getToolpath(id: string): ToolpathResult`
  - `listToolpaths(): ToolpathSummary[]`

### `packages/mcp-server/src/tools.ts` (or new `cam-tools.ts`)

**New MCP tools (3):**

#### `define_tool`
```typescript
server.tool('define_tool', 'Define a cutting tool for toolpath generation.', {
  type: z.enum(['ballnose']).describe('Tool type'),
  diameter: z.number().positive().describe('Tool diameter in mm'),
  flute_length: z.number().positive().optional().describe('Flute length in mm'),
  shank_diameter: z.number().positive().optional().describe('Shank diameter in mm'),
  name: z.string().optional().describe('Tool name/ID'),
}, async ({ type, diameter, flute_length, shank_diameter, name }) => {
  const tool: ToolDefinition = {
    name: name ?? `tool_${nextId++}`,
    type,
    diameter,
    radius: diameter / 2,
    flute_length,
    shank_diameter,
  };
  const result = registry.createTool(tool, name);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

**Readback:**
```json
{
  "tool_id": "T1",
  "type": "ballnose",
  "readback": {
    "name": "T1 ballnose D12.0",
    "diameter_mm": 12,
    "radius_mm": 6,
    "flute_length_mm": 25
  }
}
```

#### `generate_surfacing_toolpath`
```typescript
server.tool('generate_surfacing_toolpath',
  'Generate a 3-axis ball nose parallel raster surfacing toolpath.',
  {
    shape: z.string().describe('ID of shape to machine'),
    tool: z.string().describe('ID of tool to use'),
    direction: z.enum(['x', 'y']).default('x').describe('Raster direction'),
    stepover_pct: z.number().min(1).max(100).default(10)
      .describe('Stepover as % of tool diameter'),
    point_spacing: z.number().positive().optional()
      .describe('Point spacing along cut direction in mm (default: stepover distance)'),
    feed_rate: z.number().positive().describe('Cutting feed rate in mm/min'),
    plunge_rate: z.number().positive().optional()
      .describe('Plunge feed rate in mm/min (default: feed_rate / 3)'),
    rpm: z.number().positive().describe('Spindle speed'),
    safe_z: z.number().describe('Safe retract height in mm'),
    zigzag: z.boolean().default(true).describe('Zigzag (true) or unidirectional (false)'),
    name: z.string().optional().describe('Toolpath name/ID'),
  },
  async (params) => {
    const shapeEntry = registry.get(params.shape);
    const tool = registry.getTool(params.tool);
    const result = generateRasterSurfacing(shapeEntry.shape, tool, {
      direction: params.direction,
      stepover_pct: params.stepover_pct,
      point_spacing: params.point_spacing,
      feed_rate: params.feed_rate,
      plunge_rate: params.plunge_rate,
      rpm: params.rpm,
      safe_z: params.safe_z,
      zigzag: params.zigzag,
    });
    const summary = registry.createToolpath(result, params.name);
    return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
  }
);
```

**Readback:**
```json
{
  "toolpath_id": "tp_1",
  "type": "surfacing",
  "readback": {
    "name": "parallel_raster_x_T1",
    "shape": "my_part",
    "tool": "T1 ballnose D12.0",
    "point_count": 12450,
    "pass_count": 42,
    "z_range": [-15.234, 2.100],
    "cut_distance_mm": 8940,
    "rapid_distance_mm": 2100,
    "estimated_time_min": 5.8,
    "stepover_mm": 1.2,
    "warnings": []
  }
}
```

#### `export_gcode`
```typescript
server.tool('export_gcode',
  'Export a toolpath as Fanuc-compatible G-code (.nc file).',
  {
    toolpath: z.string().describe('ID of toolpath to export'),
    program_number: z.number().int().min(1).max(9999).optional()
      .describe('O-number (default: 1001)'),
    work_offset: z.string().optional().describe('Work offset (default: G54)'),
    coolant: z.enum(['flood', 'mist', 'off']).optional()
      .describe('Coolant mode (default: flood)'),
    filename: z.string().optional().describe('Output filename (default: auto from shape name)'),
  },
  async (params) => {
    const toolpath = registry.getToolpath(params.toolpath);
    const gcode = emitFanucGCode(toolpath, {
      program_number: params.program_number,
      work_offset: params.work_offset,
      coolant: params.coolant,
    });
    // Write to file
    const filename = sanitizeFilename(params.filename ?? `${toolpath.id}.nc`);
    const filePath = path.join(tmpDir, filename);
    await fs.writeFile(filePath, gcode, 'utf-8');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          toolpath_id: toolpath.id,
          type: 'gcode_export',
          file_path: filePath,
          file_size_bytes: Buffer.byteLength(gcode),
          line_count: gcode.split('\n').length,
          estimated_cycle_time_min: toolpath.stats.estimated_time_min,
        })
      }]
    };
  }
);
```

### `packages/sdf-kernel/src/index.ts`

Add exports:
```typescript
export { ToolDefinition, ToolpathPoint, ToolpathParams, ToolpathResult, generateRasterSurfacing } from './toolpath.js';
export { GCodeConfig, emitFanucGCode } from './gcode.js';
```

## Implementation Phases

### Phase 5A: Core Types & Tool Definition (1 session)

**Files:** `toolpath.ts` (types only), `registry.ts` (tool storage), `tools.ts` (define_tool)

1. Create `toolpath.ts` with all type definitions (`ToolDefinition`, `ToolpathPoint`, `ToolpathParams`, `ToolpathResult`)
2. Extend `registry.ts` with tool storage (`createTool`, `getTool`, `listTools`)
3. Add `define_tool` MCP tool to `tools.ts`
4. Write tests for tool definition and registry

**Acceptance criteria:**
- `define_tool` creates and stores a ball nose tool
- Registry returns correct readback with diameter, radius, name
- Duplicate tool names are rejected with clear error
- Tool type must be 'ballnose' (validated by Zod)

### Phase 5B: Raster Toolpath Generation (1-2 sessions)

**Files:** `toolpath.ts` (algorithm), `registry.ts` (toolpath storage), `tools.ts` (generate_surfacing_toolpath)

1. Implement `generateRasterSurfacing()` in `toolpath.ts`
   - Offset SDF by tool radius via `Round`
   - Walk raster grid with configurable direction, stepover, spacing
   - Handle null drop cutter results (air regions)
   - Compute statistics (distance, time estimate, z range)
2. Add zigzag vs unidirectional logic
3. Add safe Z retracts and approach moves
4. Extend `registry.ts` with toolpath storage
5. Add `generate_surfacing_toolpath` MCP tool
6. Write comprehensive tests

**Acceptance criteria:**
- Generate toolpath on a known box shape, verify Z values match expected
- Verify ball nose offset: Z at flat surface = surface_z (not surface_z + R)
- Zigzag: even passes go forward, odd passes go backward
- Null drop cutter points are skipped (no NaN in output)
- Stats are accurate: point_count, pass_count match
- Boundary overcut extends grid past shape bounds by tool radius

**Test cases:**
```typescript
// Test 1: Flat top box, ball nose R=5
// Box top at Z=15. Offset SDF: top at Z=20.
// Drop cutter on offset → z_center=20. z_tip = 20-5 = 15. ✓ matches surface.
const b = box(100, 60, 30);  // top at z=15
const tool = { type: 'ballnose', diameter: 10, radius: 5 };
const tp = generateRasterSurfacing(b, tool, { ... });
// All cut points should have z ≈ 15.0

// Test 2: Sphere, ball nose R=3
// Sphere R=20. At center (0,0): surface at z=20.
// Offset by 3: effective at z=23. z_tip = 23-3 = 20. ✓
// At edge (19,0): surface z ≈ 6.24
// Offset: z_center ≈ 6.24+3 offset... need to verify numerically

// Test 3: Air region (no surface)
// Point outside shape bounds → dropCutter returns null → skip point

// Test 4: Zigzag direction alternation
// Verify pass 0 goes x_min→x_max, pass 1 goes x_max→x_min
```

### Phase 5C: G-code Emission (1 session)

**Files:** `gcode.ts`, `tools.ts` (export_gcode)

1. Implement `emitFanucGCode()` in `gcode.ts`
   - Header: %, O-number, comments, G90/G21/G17
   - Tool call: T/M06 (optional)
   - Spindle: M03 S
   - Body: G00 rapids, G01 cuts with F-word
   - Modal optimization (omit unchanged axes/codes)
   - Footer: M05, M09, G00 G53 Z0., M30, %
2. Add `export_gcode` MCP tool
3. Write tests comparing output against expected G-code strings

**Acceptance criteria:**
- Output is valid Fanuc G-code (parseable by any standard G-code viewer)
- Modal optimization: unchanged coordinates omitted
- Decimal precision configurable (default 3 places)
- Comments include tool info, shape name, generation date
- Feed rate only emitted on change
- Rapids use G00 (no F-word)
- File writes to `/tmp/agent-cad/` with sanitized filename
- Estimated cycle time in return readback

**Test cases:**
```typescript
// Test 1: Simple 3-point toolpath → verify exact G-code output
// Test 2: Modal optimization → Y not emitted when unchanged
// Test 3: Feed rate changes between plunge and cut
// Test 4: Header contains program number and tool info
```

### Phase 5D: Integration Testing & Edge Cases (1 session)

1. End-to-end test: `define_tool` → `generate_surfacing_toolpath` → `export_gcode`
2. Edge cases:
   - Very small shape (smaller than tool diameter)
   - Shape with steep walls (Z changes rapidly between adjacent points)
   - Shape with holes/through-features (drop cutter finds no surface)
   - Zero stepover (should error)
   - Stepover > 100% (should warn)
3. Performance: benchmark toolpath generation on complex SDF tree
4. Verify G-code loads in an online G-code viewer

**Acceptance criteria:**
- Full workflow produces valid .nc file from any SDF shape
- No crashes on edge cases (meaningful errors instead)
- Toolpath generation < 10s for 10,000 points
- Agent readback is clear enough for Claude to make machining decisions

## Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ball nose offset via `Round(R)` incorrect on concave surfaces | Wrong Z → gouge | Test on sphere (convex), cylinder bore (concave), saddle (mixed) |
| Drop cutter misses surface on steep walls | Missing points | Reduce point spacing or add adaptive refinement |
| G-code modal optimization emits wrong state | Machine crash | Compare against manually verified G-code; keep state tracking simple |
| Performance: 100K+ drop cutter calls slow | Long generation | Profile; consider caching SDF evaluations or parallelizing |
| Null Z values create gaps in toolpath | Tool plunge to wrong Z | Handle nulls explicitly — skip or interpolate |

## Success Criteria

1. **Functional:** Claude can say "surface finish this part with a 12mm ball nose at 10% stepover" and get a .nc file
2. **Correct:** G-code Z values match expected surface contact within 0.01mm on test geometries
3. **Complete:** Full Fanuc header/footer, modal optimization, comments, safe retracts
4. **Readable:** Agent readback includes point count, pass count, Z range, estimated cycle time
5. **Tested:** >90% code coverage on toolpath.ts and gcode.ts
6. **No new dependencies** in sdf-kernel (pure TypeScript)

## References

- Brainstorm: `docs/brainstorms/2026-02-19-cam-toolpath-engine-brainstorm.md`
- VISION.md Phase 6-7 (toolpath engine)
- `sdf.ts:110-119` — `dropCutter()` implementation
- `sdf.ts:568-575` — `Round` class (ball nose offset)
- `sdf.ts:49-102` — `findSurface()` (sphere tracing + bisection)
- `tools.ts:23-37` — MCP tool registration pattern
- `registry.ts:27-47` — Shape storage pattern
