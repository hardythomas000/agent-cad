# Phase 5: SDF-Based CAM Toolpath Engine

**Date:** 2026-02-19
**Status:** Brainstorm complete, ready for planning

## What We're Building

A 3-axis surface finishing toolpath generator that operates directly on SDF geometry via drop cutter — no mesh intermediary. The AI agent defines a tool, selects a shape, and gets G-code out. First implementation: ball nose parallel raster finishing with Fanuc-compatible G-code output.

## Why This Approach

- **Drop cutter already exists** — `SDF.dropCutter()` gives sub-micron Z contact via sphere tracing + bisection. The hard geometry problem is solved.
- **SDF booleans enable stock tracking** — future rest machining is `subtract(stock, swept_volume)`, guaranteed robust.
- **Ball nose simplifies contact math** — contact point = tool center projected to surface. No compensation geometry needed for the first increment.
- **Parallel raster is the simplest pattern** — walk XY grid lines, drop at each point, connect with G01. Minimal algorithm complexity.
- **Fanuc G-code is universal** — G90 G01 X Y Z F runs on virtually any 3-axis mill.

## Key Decisions

1. **Tool geometry:** Ball nose only (first increment)
2. **Toolpath pattern:** Parallel raster (unidirectional or zigzag along X or Y)
3. **G-code target:** Generic Fanuc 3-axis (G90, G01, G00 rapids, M03/M05)
4. **Interface:** MCP tools — Claude drives the full workflow
5. **Parameters:** Fully parameterised from day one (tool diameter, stepover %, feed rate, RPM, safe Z, cut direction)
6. **Ball nose contact:** For a ball nose of radius R, the tool tip center is at Z_contact + R. The drop cutter finds Z_contact for a point tool — we offset by R for the ball nose.

## Scope — What's IN

- `define_tool` MCP tool — ball nose with diameter, flute length, shank diameter
- `generate_surfacing_toolpath` MCP tool — takes shape ID, tool ID, parameters → returns toolpath data
- `export_gcode` MCP tool — takes toolpath → writes .nc file
- Parallel raster pattern (X or Y direction, zigzag option)
- Configurable: stepover, feed rate, plunge rate, RPM, safe Z, retract Z
- Lead-in / lead-out (linear approach/retract per pass)
- G-code header/footer (program number, tool call, spindle on/off, coolant)

## Scope — What's OUT (future phases)

- Other tool geometries (flat end, bull nose, drill)
- Other patterns (waterline, spiral, pencil, scallop)
- Adaptive/HSM roughing
- Stock tracking / rest machining
- Tool radius compensation (G41/G42)
- 4th/5th axis
- Machine-specific posts (Mazak, Haas, etc.)
- Collision detection
- Simulation / material removal verification
- Automatic stepover calculation from scallop height

## Architecture Notes

### New files (sdf-kernel)
- `src/toolpath.ts` — ToolDefinition type, RasterSurfacingStrategy, ToolpathPoint[]
- `src/gcode.ts` — GCodeEmitter class, Fanuc dialect

### New files (mcp-server)
- Tool handlers added to `tools.ts` (or split into `cam-tools.ts`)

### Data flow
```
Claude: define_tool({ type: "ballnose", diameter: 12 })
Claude: generate_surfacing_toolpath({
  shape: "my_part",
  tool: "tool_1",
  stepover_pct: 15,
  feed_rate: 2000,
  rpm: 10000,
  safe_z: 50,
  direction: "x"
})
Claude: export_gcode({ toolpath: "tp_1" })
→ writes /tmp/agent-cad/my_part_surfacing.nc
```

### Ball nose drop cutter offset
```
For ball nose radius R at grid point (x, y):
  z_surface = shape.dropCutter(x, y, zTop, zBottom)
  z_tool_tip = z_surface  (point tool contact)
  z_tool_center = z_surface + R  (ball center)
  G-code Z = z_tool_tip  (program to tip, controller knows R from tool table)

Actually: program the tip position. The machine's tool length offset handles the rest.
So G-code Z = z_surface. The drop cutter gives us exactly what we need.

Wait — drop cutter finds where a POINT contacts the surface.
For a ball nose of radius R, the effective contact is different:
The ball nose touches the surface at the point closest to the ball center.
For a vertical drop, the ball center is at (x, y, z_center).
The ball touches the surface at the lowest point within radius R of (x, y).

Correct approach: we need a "ball drop cutter" — find the Z where a
sphere of radius R, centered at (x, y, Z), first contacts the SDF surface.
This is: find Z where SDF evaluated at distance R from (x, y, Z) = 0.
Equivalent to: drop cutter on the SDF offset by -R (Minkowski sum).

Implementation: create a temporary SDF that is shape.round(-R)...
or equivalently, evaluate shape.sdf(p) - R (offset surface outward by R),
then drop a point tool on that offset surface.
This gives the Z of the ball CENTER. Subtract R to get the tip Z for G-code.

SIMPLER: shape.dropCutter gives Z for a point. For ball nose:
  offset_shape = new Round(shape, -R)  // expand surface by R
  z_ball_center = offset_shape.dropCutter(x, y, zTop, zBottom)
  z_tip = z_ball_center - R
  G-code Z = z_tip
```

## Open Questions

1. **Zigzag vs unidirectional?** Zigzag is faster (no retract between passes). Unidirectional gives better surface finish. Support both, default to zigzag?
2. **Point spacing along each raster line?** Should match stepover or be finer? Typically 0.5-1x stepover for ball nose finishing.
3. **Arc fitting (G02/G03)?** Linear moves only for v1. Arc fitting is an optimisation for later.
4. **Boundary clipping?** Should toolpath stay within shape bounds or allow overshoot for full coverage? Default: overshoot by tool radius.
5. **Ball nose offset SDF** — the `Round` node with negative radius may not behave correctly (it's designed for positive radius = fillet). Need to verify or implement a `MinkowskiOffset` node.
