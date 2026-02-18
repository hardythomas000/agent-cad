# Brainstorm: First LLM-Authored Geometry Demo

**Date:** 2026-02-18
**Status:** Ready for planning
**Context:** agent-cad chosen as THE project. This brainstorm defines the first concrete demo.

## What We're Building

The first end-to-end demo of an LLM authoring manufacturing geometry through the MCP server.
Claude generates geometry → kernel evaluates → result is viewable/exportable.

## Current State (What Already Works)

- SDF kernel: 6 primitives, booleans (smooth + hard), transforms, modifiers (82 tests)
- MCP server: 23 tools (create_box, boolean_subtract, translate, compute_mesh, export_mesh, etc.)
- Mesh extraction: marching cubes → binary STL
- Structured readback: every operation returns bounds, size, center
- Drop cutter query: Z-contact search (first toolpath primitive)

## What's Missing for the Demo

1. **MCP server not running/registered** — need to verify it works with Claude Code
2. **No viewer** — can export STL but no way to see results in-browser
3. **No agent loop tested** — nobody has tried "natural language → MCP → geometry" end-to-end
4. **No validation** — LLM can create bad geometry with no safety net

## Proposed Demo: "Claude Machines a Bracket"

The demo prompt to Claude (via MCP):
"Create a 150x80x40mm aluminum block. Cut a pocket 120x60x25mm from the top face,
leaving 15mm walls. Add two through-holes, 10mm diameter, 30mm from each end.
Fillet the pocket floor edges at 3mm. Export as STL."

Claude would call MCP tools in sequence:
1. `create_box(150, 80, 40)` → stock block
2. `create_box(120, 60, 25)` → pocket shape
3. `translate(pocket, 15, 10, 15)` → position pocket
4. `boolean_subtract(stock, pocket)` → cut pocket
5. `create_cylinder(5, 50)` → hole 1
6. `translate(hole1, 30, 40, 0)` → position hole
7. `boolean_subtract(part, hole1)` → drill hole 1
8. Repeat for hole 2
9. `round_edges(part, 3)` → fillet (approximate via SDF offset)
10. `compute_mesh(part, 0.5)` → extract mesh
11. `export_mesh(part, "bracket.stl")` → save file

## Approach: Simplest Path to Working Demo

**Step 1: Verify MCP server runs locally**
- `cd packages/mcp-server && npm install && npm run build`
- Test with a simple tool call

**Step 2: Register MCP server in Claude Code settings**
- Add to `~/.claude.json` or project `.claude/settings.json`
- Verify Claude can see and call the tools

**Step 3: Run the demo prompt**
- Claude authors the bracket geometry via MCP
- Each step returns structured readback
- Final step exports STL

**Step 4: View the result**
- Open STL in external viewer (3D Viewer in Windows, or SolidWorks/Rhino on Hardy's machine)
- Alternatively: build minimal Three.js viewer page (one HTML file)

## Key Decisions

1. **Demo first, viewer later** — don't block the demo on Phase 1 (viewer). Export STL and view externally.
2. **Real part, not toy** — the bracket is something Hardy would actually machine. Proves relevance.
3. **Structured readback is the test** — the demo succeeds if Claude can read the kernel's responses and self-correct.
4. **Validation comes after** — port from token-native-geo once the happy path works.

## What This Proves

If this demo works, it proves the core thesis: an LLM can author manufacturing geometry
as naturally as it writes code. The kernel handles the math. The LLM handles the intent.
No GUI. No mesh vertices in the prompt. Just code.
