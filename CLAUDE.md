# Agent CAD

## What This Is
An SDF-based geometry kernel with an MCP server that lets LLMs author CAD geometry as code. The thesis: SDF expressions are ~35 tokens vs ~8,500 for mesh — making geometry as natural for LLMs as writing Python.

## Architecture
- **Monorepo** with npm workspaces
- `packages/sdf-kernel/` — TypeScript SDF kernel (primitives, booleans, transforms, marching cubes, STL export)
- `packages/mcp-server/` — MCP server exposing 43 tools for Claude to call directly
- `packages/viewer/` — Vite + Three.js + CodeMirror 6 split-pane viewer (STL display)
- `docs/` — VISION.md (full roadmap), architecture paper, brainstorms
- `todos/` — File-based todo tracking (compound-engineering pattern)

## Key Files
- `packages/sdf-kernel/src/sdf.ts` — Core SDF node class, all primitives, booleans, transforms
- `packages/sdf-kernel/src/api.ts` — Fluent API: `box()`, `sphere()`, `cylinder()`, `union()`, `subtract()`
- `packages/sdf-kernel/src/marching-cubes.ts` — Mesh extraction
- `packages/sdf-kernel/src/stl.ts` — Binary STL export
- `packages/mcp-server/src/tools.ts` — 43 MCP tool definitions
- `packages/mcp-server/src/registry.ts` — In-memory shape registry with readback
- `packages/viewer/src/main.ts` — Viewer entry point
- `packages/viewer/src/scene.ts` — Three.js scene, lights, grid, axes
- `packages/viewer/src/editor.ts` — CodeMirror 6 with teal/gold/copper theme

## MCP Server
Registered in `~/.claude.json`. Exposes 43 tools:
- **Primitives (6):** create_box, create_sphere, create_cylinder, create_cone, create_torus, create_plane
- **2D Profiles (3):** create_polygon, create_circle_2d, create_rect_2d
- **2D → 3D (2):** extrude, revolve
- **Profile Management (2):** list_profiles, delete_profile
- **Booleans (3):** boolean_union, boolean_subtract, boolean_intersect (all support smooth_radius for fillets)
- **Transforms (4):** translate, rotate, scale_shape, mirror_shape
- **Modifiers (3):** shell, round_edges, elongate
- **Queries (3):** get_shape, evaluate_point, drop_cutter
- **Mesh (2):** compute_mesh, export_mesh
- **CAM (4):** define_tool, generate_surfacing_toolpath, generate_contour_toolpath, export_gcode
- **Topology (4):** query_faces, query_face, classify_point, query_edges
- **Semantic Features (3):** create_hole, create_pocket, create_bolt_circle
- **Edge Operations (2):** chamfer_edge, fillet_edge
- **Session (2):** list_shapes, delete_shape

Every tool returns structured JSON readback (shape_id, type, bounds, size, center) — the LLM's "eyes" since it can't see the 3D viewer.

## Commands
```bash
# Build everything
npm run build

# Run tests (374 passing)
npm test

# Build just the kernel
cd packages/sdf-kernel && npm run build

# Build just the MCP server
cd packages/mcp-server && npm run build

# Start MCP server manually (stdio transport)
node packages/mcp-server/dist/index.js

# Start viewer dev server
npm run dev:viewer
# or: cd packages/viewer && npm run dev
```

## Status (as of 2026-02-20)
### Done
- SDF kernel with 6 primitives, 3 booleans (+ smooth variants), 4 transforms, 3 modifiers
- 2D profiles: polygon, circle2d, rect2d + extrude/revolve (drawing→SDF bridge)
- Marching cubes mesh extraction
- Binary STL export
- MCP server with 43 tools (incl. 2D profiles, CAM, G-code, topology, edge operations)
- Shape registry with structured readback
- Root finding (sphere tracing + bisection)
- 3-axis raster surfacing toolpath (drop-cutter based)
- 2D contour/profile toolpath (marching squares + SDF offset)
- Fanuc G-code emission (surfacing + contour)
- 374 tests passing
- First LLM-authored geometry demo: bracket with pocket + 2 through-holes (bracket.stl)
- Viewer v1: Three.js STL viewer + CodeMirror 6 editor + split pane (Vite app)
- Viewer v2: live kernel connection — editor DSL executes against kernel, mesh renders in viewport (debounced, Ctrl+Enter, error overlay)
- Named topology: analytical face/edge identity for all 20 SDF node classes (faces, edges, classifyPoint)
- Edge topology completion: mergeEdges, smooth boolean propagation, shell doubling, query_edges MCP tool
- Semantic DSL v1: hole(), pocket(), boltCircle() — intent-based features on named faces
- Semantic DSL v2: chamfer(), fillet() — edge operations on named edges (EdgeBreak SDF node)
- Viewer v3: face highlighting on hover with status bar readout (raycaster + vertex colors)
- CAM v2: contour toolpath — marching squares contour extraction + SDF-native tool offset

### Not Started
- Semantic DSL v3 (constraint solver)
- B-Rep export (STEP/IGES via OCCT)
- Benchmark gates (ADR-001 pattern)
- Validation pipeline

## Design Principles (from VISION.md)
1. **Intent-based, not coordinate-based** — describe what, not where
2. **Self-describing kernel** — every operation returns readback
3. **Named topology** — faces/edges have semantic names
4. **Forgiving / self-healing** — never crash, always return usable geometry
5. **Small API surface** — ~44 functions total
6. **SDF-first booleans** — min/max, never fails
7. **Feedback loop as product** — error messages teach the LLM
8. **Semantic DSL** — `box(100,60,30).subtract(cylinder(5).at(50,30,0))`

## Related Projects
- `token-native-geometry` (same GitHub repo, renamed from `frame-assist`) — Python prototype + interactive whitepaper. Archived as research. Whitepaper at `frame-assist/docs/whitepaper.html`.
- Architecture paper: `docs/token-native-geometry-architecture.md`

## Windows Notes
- Use forward slashes in bash, backslashes in PowerShell
- npm optional deps: if `@rollup/rollup-win32-x64-msvc` error, delete node_modules and reinstall
- STL exports go to the repo root or system temp dir
