# Agent CAD — Vision Document

## The One-Sentence Pitch

An agent-native, browser-based, code-first CAD/CAM system with its own hybrid geometry kernel — where booleans are as simple as shadow overlap, and there's finally a "KCL for machining."

## The Problem

1. **No KCL for machining.** Zoo proved code-first CAD works. But the manufacturing side — toolpaths, G-code, post-processing — has no equivalent. There is no production-quality open-source CAM.

2. **Interoperability is still broken.** 43% of companies cite it as their top CAD challenge. 30% of digital models contain anomalies. STEP files are "dead geometry" — parameters and intent are permanently lost.

3. **Existing CAM is painful.** Mastercam crashes. Fusion 360 breaks between updates. Post processors are black boxes. 5-axis is a maze. Verification takes longer than cutting.

4. **AI can't touch geometry.** Current CAD/CAM is GUI-first. LLMs can't click buttons. The agent opportunity requires geometry-as-code, and that doesn't exist for manufacturing.

## The Core Insight: Shadow Graphs

Traditional B-Rep booleans are the hardest problem in computational geometry — surface-surface intersection, topology rebuild, tolerance nightmares. Parasolid has 30 years of bug fixes and still fails on edge cases.

But shadows perform natural boolean operations. Two shadows overlap = union. One blocks another = subtract. The computational complexity is trivial — just evaluate at each point.

**Signed Distance Fields (SDF)** are the mathematical equivalent:
```
union(A, B)     = min(distA, distB)
subtract(A, B)  = max(distA, -distB)
intersect(A, B) = max(distA, distB)
```

The tradeoff: SDFs are approximate. Manufacturing needs exact geometry at the tool tip. But not everywhere — only at the toolpath.

**Agent CAD's architecture: SDF for modeling, exact geometry only at the cutting edge.**

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Agent Layer (MCP + LLM code generation)        │
│  "rough this pocket, 1/2" endmill, leave 0.5mm" │
├─────────────────────────────────────────────────┤
│  Code Layer (TypeScript API / DSL)              │
│  box(100,60,30).subtract(cylinder(5).at(20,15)) │
├─────────────────────────────────────────────────┤
│  Hybrid Kernel                                  │
│  ┌──────────────┐  ┌────────────────────┐       │
│  │ SDF Engine    │  │ B-Rep Engine       │       │
│  │ (Fidget/WASM)│  │ (OCCT/WASM)        │       │
│  │ Fast booleans │  │ Exact NURBS        │       │
│  │ min/max ops   │  │ STEP I/O           │       │
│  │ Organic shapes│  │ Precise faces      │       │
│  └──────┬───────┘  └──────┬─────────────┘       │
│         │  surface extract  │                    │
│         └──────────┬───────┘                    │
│                    ▼                             │
│  ┌─────────────────────────────────────┐        │
│  │ Toolpath Engine                      │        │
│  │ Clipper2 (2D offset) + OpenCAMlib   │        │
│  │ + custom HSM/trochoidal algorithms  │        │
│  └─────────────────┬───────────────────┘        │
│                    ▼                             │
│  ┌─────────────────────────────────────┐        │
│  │ Post Processor (transparent, code)  │        │
│  │ G-code output, machine-specific     │        │
│  └─────────────────────────────────────┘        │
├─────────────────────────────────────────────────┤
│  Viewer (Three.js + WebGPU)                     │
│  Dark theme, teal wireframes, gold accents      │
│  Interactive NURBS surfaces, live normals        │
└─────────────────────────────────────────────────┘
```

## Building Blocks (Use, Don't Rewrite)

| Component | Library | License | Why |
|-----------|---------|---------|-----|
| B-Rep kernel | OpenCascade.js (WASM) | LGPL 2.1 | Most complete. STEP I/O. Custom builds shrink size. |
| Mesh booleans | Manifold (WASM) | Apache 2.0 | Guaranteed-manifold. Fast. npm ready. |
| SDF/Implicit | Fidget (Rust/WASM) | MPL 2.0 | Blazing fast. JIT native, interpreter WASM. By libfive creator. |
| 2D operations | Clipper2-WASM | Boost | Industry standard polygon offset/clip. Essential for toolpaths. |
| Toolpath gen | OpenCAMlib (WASM) | LGPL | Drop-cutter, push-cutter. Browser-ready. |
| 3D rendering | Three.js + WebGPU | MIT | Mature. Auto WebGL fallback. CAD extensions exist. |
| Constraint solver | Custom (study JSketcher) | — | 2D sketch constraints. JSketcher is the reference. |

## What We Build Ourselves

1. **The DSL / TypeScript API** — the "KCL for machining." Fluent, chainable, LLM-friendly.
2. **The hybrid kernel bridge** — SDF ↔ B-Rep conversion, surface extraction, precision baking.
3. **The toolpath DSL** — describe machining intent in code, not GUI clicks.
4. **The post processor framework** — transparent, debuggable, version-controlled.
5. **The MCP server** — expose every operation as an agent-callable tool.
6. **The viewer** — our aesthetic. Dark charcoal, teal wireframes, gold accents, JetBrains Mono.
7. **The agent loop** — LLM generates code, kernel executes, viewer shows result, agent iterates.

## Aesthetic

Reference: `~/agent-cad/aesthetic-reference.png`

| Element | Value |
|---------|-------|
| Background | #0a0a0c (deep charcoal) |
| Card/panel bg | #18181c |
| Wireframe lines | rgba(74,158,142,0.15) — teal |
| Highlighted geometry | #c9a84c — warm gold |
| Surface normals | #b87333 — copper |
| Code keywords | #4a9e8e — teal |
| Code strings/entities | #c9a84c — gold |
| Code numbers | #b87333 — copper |
| Code comments | #55534e — dim grey italic |
| Heading font | DM Serif Display |
| Body font | Source Serif 4 |
| Code/data font | JetBrains Mono |

## What "Agent-Native" Means

1. **Code-first API** — every operation is code, not clicks. GUI is visualization over API.
2. **Deterministic** — same code = same geometry. Always.
3. **Introspectable** — system describes its own state in LLM-readable format.
4. **MCP tools** — create_sketch, extrude, fillet, boolean, generate_toolpath, export.
5. **Bidirectional** — agent creates AND queries geometry (measure, check interference, validate).
6. **Streaming feedback** — real-time success/failure with geometric context.

## LLM-Native Kernel Design

The fundamental rethink: every existing kernel (Parasolid, ACIS, OCCT) was designed for **human programmers writing C++**. Agent CAD's kernel is designed for **LLMs generating code**. This changes everything.

### LLM Strengths (Exploit These)
- Generating structured, fluent API chains with named parameters
- Working with **semantic concepts** — "the top face", "the pocket floor", "the hole near the corner"
- Expressing **intent** — "rough this pocket leaving 0.5mm" rather than specifying 47 toolpath parameters
- Pattern reuse — "mirror this", "repeat on a bolt circle of 6"
- Constraint reasoning — "flush with", "concentric", "tangent to"

### LLM Weaknesses (Design Around These)
- **Hallucinate coordinates** — get signs wrong, can't do reliable trig, invent plausible-but-wrong numbers
- **No spatial reasoning** — can't "see" interference, tool access, surface self-intersection
- **Lose dimensional consistency** — change one value, forget three dependent ones
- **Can't debug geometry** — no idea why a boolean failed or where topology broke

### Design Principle 1: Intent-Based, Not Coordinate-Based

```typescript
// BAD — traditional kernel (LLM will get coordinates wrong)
sketch.addLine(0, 0, 100, 0)
sketch.addLine(100, 0, 100, 60)
sketch.addArc(100, 60, 80, 60, 90, 60, 10)

// GOOD — LLM kernel (declare intent, kernel resolves geometry)
box(100, 60, 30)
  .fillet("top_edges", 10)
  .hole("top_face", dia=10, depth=20, at="center")
```

The LLM should almost never write raw coordinates. Placement is relative, semantic, constrained.

### Design Principle 2: The Kernel Talks Back (Self-Describing)

After every operation, the kernel returns a **structured text readback** — because the LLM can't look at the 3D view:

```json
{
  "result": "success",
  "body": {
    "bounds": {"x": [0,100], "y": [0,60], "z": [0,30]},
    "faces": 8,
    "named_faces": {"top": "face_7", "bottom": "face_1", "front": "face_3"},
    "volume_mm3": 176520,
    "features": ["box_base", "fillet_1", "hole_1"],
    "warnings": []
  }
}
```

Critical feedback types:
- **After modeling**: bounding box, volume, face/edge count, named topology map
- **After toolpath**: estimated cycle time, tool load %, rapid distance, gouge/collision warnings
- **After boolean failure**: WHY it failed, WHERE the problem is, WHAT to try instead
- **On demand**: interference check, machinability check, measurement between features

### Design Principle 3: Named Topology (Not Shifting Indices)

Traditional kernels identify faces/edges by internal IDs that change after every boolean. LLMs can't track this. Instead:

```typescript
const block = box(100, 60, 30)
// Kernel auto-names: top, bottom, left, right, front, back

block.face("top")                        // stable semantic name
block.edge("top", "front")               // edge at intersection of named faces
block.vertex("top", "front", "right")    // corner by three-face intersection
```

After booleans, the kernel maintains a **name genealogy**:
- Subtract cylinder from top → `"top.subtract_1.floor"`, `"top.subtract_1.wall"`
- Fillet an edge → `"fillet_1.face"` replaces the original edge reference

### Design Principle 4: Forgiving / Self-Healing

LLMs will make mistakes. The kernel should recover gracefully:
- **Snap near-misses**: hole placed 0.001mm outside face → snap it onto the face
- **Suggest corrections**: `"hole dia 50mm exceeds face width 30mm — did you mean 5mm?"`
- **Never silently fail**: always explain what went wrong, in text
- **Offer alternatives**: `"boolean failed — bodies don't intersect. Gap: 2.3mm. Suggest: translate by [0,0,-2.3]"`

### Design Principle 5: Small API Surface (~35 Functions)

LLMs perform best with a small vocabulary seen many times in training:

```
Primitives:   box, cylinder, sphere, cone, torus, plane           (6)
2D Sketch:    line, arc, circle, rectangle, polygon, spline       (6)
Transforms:   move, rotate, mirror, scale, pattern_linear,
              pattern_circular                                     (6)
Booleans:     union, subtract, intersect                          (3)
Features:     extrude, revolve, sweep, loft, fillet, chamfer,
              shell, hole, pocket, boss                           (10)
Queries:      measure, bounds, faces, edges, volume, interference (6)
Toolpath:     profile, pocket_clear, drill, surface_finish        (4)
Export:        to_step, to_stl, to_gcode                          (3)
                                                          Total: ~44
```

A machinist's entire vocabulary in 44 functions. Not 3,000.

### Design Principle 6: SDF-First (Booleans That Never Fail)

B-Rep booleans fail silently, produce degenerate geometry, require tolerance management. An LLM can't debug any of that. SDFs just work:

```typescript
union(A, B)     = min(distA, distB)     // always succeeds
subtract(A, B)  = max(distA, -distB)    // always succeeds
intersect(A, B) = max(distA, distB)     // always succeeds
```

LLM works in **SDF space** (never fails) → kernel converts to B-Rep **only at export/toolpath boundary** where exact geometry is needed.

### Design Principle 7: The Feedback Loop IS the Product

```
LLM generates code
  → Kernel executes, returns text description + measurements
    → LLM reads description, decides if result matches intent
      → Generates correction or next operation
        → Kernel executes...
```

The viewer is for the human. The text readback is for the LLM. Both see the same geometry — just in different modalities.

### The DSL Should Read Like a Machinist's Notebook

```typescript
const stock = box(150, 80, 40, material="6061-T6")

const part = stock
  .subtract(pocket("top", 120, 60, depth=25, corners=5))
  .subtract(hole("top", dia=10, depth="through", at=[30, 20]))
  .subtract(hole("top", dia=10, depth="through", at=[90, 20]))
  .fillet("pocket.floor_edges", 3)

const program = machine(part, stock)
  .face("top", tool="3in_facemill", leave=0.5)
  .rough_pocket("pocket_1", tool="1/2_endmill", stepover=0.4, leave=0.25)
  .finish_pocket("pocket_1", tool="1/4_endmill", stepover=0.1)
  .drill(["hole_1", "hole_2"], tool="10mm_drill", peck=5)
  .finish_face("top", tool="3in_facemill")

program.post("fanuc", output="part_001.nc")
```

An LLM can generate this. A machinist can read this. The kernel handles everything between.

### Design Principle 8: Token-Native Geometry

The architecture paper (see `docs/token-native-geometry-architecture.md`) establishes the theoretical foundation: LLM hidden layers organize information on high-dimensional manifolds where intrinsic dimension collapses at mid-layers — this is where geometric reasoning happens. Our SDF kernel is the computational substrate for this:

- **SDF is the right representation** — the paper positions SDF/neural occupancy as the differentiable, agent-native alternative to Parasolid/ACIS. Our kernel IS this.
- **MCP is the token-efficient architecture** — the paper warns against "context bloat" from loading raw geometry into the context window. Our MCP server keeps shapes in a registry and returns compact readback summaries. The LLM never sees raw coordinates.
- **B-Rep tokenization is the bridge to industry** — frameworks like BrepARG and DTGBrepGen show how to serialize B-Rep for transformers. Our export path (SDF→mesh→B-Rep) will need this.
- **Equivariance matters** — EquiCAD shows SO(3)/O(3)-equivariant networks guarantee orientation-invariant features. Our kernel handles this via composable transform nodes, but future ML training on SDF operations would benefit from explicit equivariant encoding.
- **Topology-geometry decoupling** — DTGBrepGen generates valid topology first, then populates geometry. This validates our "SDF for modeling, B-Rep only at export" architecture.

### Research Validation (February 2026)

These principles aren't theoretical — they're backed by emerging research:

**Error feedback is the single biggest lever.** Text-to-CadQuery (2025) showed that simply feeding execution errors back to the LLM raises success rate from **53% to 85%**. This validates Design Principle 2 (self-describing kernel) — structured error messages are worth more than any other single feature.

**Language design > training data.** AIDL (2025) built a DSL the LLM had *never seen in training* — it outperformed OpenSCAD (which is in training data) on output quality. Why? Because constraints + solver + named hierarchy matters more than familiarity. This validates our DSL approach over "just use OpenSCAD because GPT knows it."

**Constraint solvers, not LLM math.** The pattern across all successful systems: LLM specifies *intent and relationships* ("concentric", "flush", "equal spacing"), a solver computes exact positions. LLMs get trig wrong. LLMs get coordinate signs wrong. Only 5% of LLM-generated CSG parameters exactly match ground truth. Offload precision to solvers.

**Multi-view visual snapshots matter.** Zoo's Zookeeper (Jan 2026) takes multi-angle renders after each step. CAD-Assistant overlays numbered primitive IDs on renders so the LLM can reference geometry by label. Our viewer should support agent-requested screenshot captures with face/edge annotations.

**Proven kernel underneath, LLM-friendly API on top.** ElectricSQL (Jan 2026) tried building a geometry kernel from scratch with LLM help. Straight-line sketches and extrudes worked. Then they hit angled face trimming — "each fix created new problems." After switching to OpenCascade/WASM, "operations that took days of debugging became afternoon tasks." This validates our hybrid approach: OCCT for kernel math, our DSL for the LLM interface.

**Zookeeper's architecture = our architecture.** Zoo's agent follows: Plan → Act → Observe → Update → Repeat. With tools for: execute code + check errors, take visual snapshots, compute measurements (CoM, mass, volume, surface area), search docs, and a time-traveling debugger. We should study this closely.

**What LLMs are good at (exploit):**
- Decomposing complex shapes into simpler primitives
- Writing parametric relationships between dimensions
- Semantic naming and hierarchical structure
- Sketch → extrude workflows
- Self-correcting from structured error messages

**What LLMs are bad at (offload to kernel/solver):**
- Precise spatial positioning → constraint solver
- Trigonometry and angular math → math library
- Global coherence across parts → solver + named topology
- Intersection math → proven kernel (OCCT)
- Exact numeric parameters → only 5% exact match in research

**Representation ranking for LLMs (best to worst):**
1. Sketch-extrude sequences via CadQuery/Python (most natural)
2. CSG tree operations (compact, editable)
3. Parametric code with constraints (best output quality)
4. Direct B-Rep / STEP (hostile to autoregressive generation)
5. Raw mesh vertices (worst — too many tokens, non-editable)

### Key Sources
- [Zoo KCL](https://zoo.dev/research/introducing-kcl) — KCL language design for LLM-friendly CAD
- [Zookeeper](https://zoo.dev/research/zookeeper) — conversational CAD agent architecture
- [Text-to-CadQuery](https://arxiv.org/html/2505.06507v1) — error feedback: 53% → 85% success
- [AIDL](https://arxiv.org/html/2502.09819v1) — constraint-based DSL beats OpenSCAD despite zero training data
- [CAD-Assistant](https://arxiv.org/html/2412.13810v1) — tool-augmented VLLM with annotated renders
- [CAD-Coder](https://arxiv.org/html/2505.19713) — geometric reward signals for RL
- [ElectricSQL blog](https://electric-sql.com/blog/2026/01/20/from-science-fiction-to-reality-you-can-build-difficult-things-now) — LLM + kernel from scratch, pivoted to OCCT
- [STEP-LLM](https://arxiv.org/html/2601.12641v1) — generating STEP files directly from LLMs
- [GeoGramBench](https://arxiv.org/html/2505.17653v1) — LLMs: >80% local primitives, <50% global integration
- Token-Native Geometry Architecture (internal) — custom kernels, B-Rep tokenization, agent-native CAM, equivariance, MCP token efficiency. See `docs/token-native-geometry-architecture.md`

## The Killer Features (Things That Don't Exist)

1. **Machining intent as code** — `pocket(face, tool="1/2 EM", stepover=0.4, leave=0.5)` not 15 dialog boxes.
2. **Stock-aware programming** — the system tracks in-process stock and suggests next operations.
3. **Transparent post-processing** — see exactly what G-code each intent produces. Debug it like code.
4. **Manufacturing-aware modeling** — collision, tool access, and machinability checked during design.
5. **Institutional knowledge** — agent learns shop-specific strategies from historical programs.
6. **Shadow-graph booleans** — model with SDF simplicity, machine with B-Rep precision.

## Phased Roadmap

### Phase 0: Foundation ✅
- [x] Research landscape
- [x] Define aesthetic
- [x] Vision document
- [x] Token-native geometry theory paper (`docs/token-native-geometry-architecture.md`)
- [x] Set up monorepo (npm workspaces, TypeScript)

### Phase 1: The Viewer ✅
- [ ] Load and display STEP files (via occt-import-js — deferred to Phase 5)
- [x] Interactive 3D view with our aesthetic (dark charcoal, gold geometry, teal grid)
- [x] Code editor pane (CodeMirror 6) with our colour theme
- [x] Split-pane: code left, 3D right (draggable divider)
- [x] Live code execution (300ms debounce, Ctrl+Enter)
- [x] STL drag-and-drop loading
- [x] View presets (Front/Back/Left/Right/Top/Bottom/Iso)
- [x] Display modes (Shaded, S+Edge, S+Wire, Wireframe)
- [x] Perspective/Orthographic camera toggle
- [x] Grid + axes toggles
- [x] Light/dark theme toggle
- [x] Status bar (triangle count, dimensions)

### Phase 2: SDF Kernel ✅
- [x] TypeScript geometry API (fluent, chainable) — `@agent-cad/sdf-kernel`
- [x] Primitives: box, cylinder, sphere, cone, torus, plane (6)
- [x] SDF booleans: union, subtract, intersect + smooth variants (6)
- [x] Transforms: translate, rotate, scale, mirror (4)
- [x] Modifiers: shell, round, elongate (3)
- [x] Sphere tracing + bisection root finding
- [x] Drop cutter (CAM primitive — Z-contact search)
- [x] Structured readback (name, bounds, size, center)
- [x] 2D profiles: Polygon2D, Circle2D, Rect2D
- [x] Extrude (2D→3D, exact Quilez formula)
- [x] Revolve (2D→3D around Z axis)
- [x] 169 tests passing

### Phase 3: Agent Layer ✅
- [x] MCP server exposing 33 tools (`@agent-cad/mcp-server`)
- [x] In-memory shape registry with auto/named IDs
- [x] 2D profile registry (create, list, delete profiles)
- [x] Every tool returns structured readback (the "kernel talks back" principle)
- [x] Registered in Claude Code as MCP server
- [x] First LLM-authored geometry: bracket with pocket + 2 through-holes (bracket.stl)
- [ ] Natural language → geometry workflow testing
- [ ] Agent loop: describe → generate → execute → verify → iterate
- [ ] Setup sheet generation from machining context

### Phase 4: Mesh Export & Visualization ✅
- [x] Marching cubes (SDF → triangle mesh)
- [x] Binary STL export
- [x] Three.js viewer integration (display SDF-derived meshes in real-time)
- [ ] Agent-requested screenshot captures with face/edge annotations

### Phase 5: B-Rep Bridge
- [ ] OpenCascade.js integration (custom build, minimal)
- [ ] STEP import → B-Rep → display
- [ ] SDF → mesh → NURBS fitting for critical faces
- [ ] STEP export from internal representation
- [ ] B-Rep tokenization path (informed by BrepARG/DTGBrepGen research)

### Phase 6: Toolpath Engine
- [ ] `generate_toolpath` MCP tool — drop_cutter in grid pattern → Z-map
- [ ] Clipper2-WASM for 2D contour offset
- [ ] Pocket clearing (zigzag, contour parallel)
- [ ] Profile cutting (inside/outside)
- [ ] Drill cycle generation
- [ ] G-code output (Fanuc dialect first)
- [ ] Toolpath visualization in viewer
- [ ] Tokenized toolpath representation (compact, agent-readable)

### Phase 7: 3D Toolpath & Surface Finishing
- [ ] OpenCAMlib integration (WASM) or custom surface algorithms
- [ ] Surface finishing (waterline, raster, flowline)
- [ ] Rest machining (stock model tracking)
- [ ] Toolpath simulation (stock removal visualization)

### Phase 8: Advanced Manufacturing
- [ ] 5-axis toolpath generation
- [ ] HSM/trochoidal clearing algorithms
- [ ] Variable-radius fillets in SDF
- [ ] Multi-setup planning
- [ ] Post processor framework (machine-specific dialects)
- [ ] Institutional knowledge capture

### Phase 9: Spatial Intelligence (Informed by Token-Native Geometry Paper)
- [ ] SO(3)/O(3)-equivariant feature encoding for SDF operations
- [ ] Spectral-preserving tokenization (Heat Kernel Signatures on meshes)
- [ ] Multi-modal alignment (language + vision + 3D geometry tokens)
- [ ] Neurosymbolic constraint discovery (parametric CAD from intent)
- [ ] Generative world model — editable, persistent 4D environments

## Prior Art (Closest Projects)

| Project | Status | What We Learn |
|---------|--------|---------------|
| CADmium | Archived Sept 2025 | Rust/Truck + Three.js + WASM in browser. Pick up where they left off. |
| JSketcher | Active | 2D constraint solver + OCCT in browser. Study their solver. |
| Chili3D | Active | TypeScript + OCCT + Three.js architecture. |
| ManifoldCAD | Active | Code editor + 3D viewer browser UX. |
| Zoo KCL | Active (cloud) | Language design for CAD. Opposite arch (cloud kernel). |
| CadQuery | Active | Fluent Python API design. Text-to-CadQuery proves LLM generation works. |
| build123d | Active | Clean Pythonic CAD API. Context-manager pattern. |

## Tech Stack

- **Frontend:** TypeScript, Vite, Three.js (WebGPU renderer)
- **Kernel (WASM):** Fidget (SDF), OpenCascade.js (B-Rep), Manifold (mesh booleans)
- **Toolpath (WASM):** Clipper2, OpenCAMlib
- **Code editor:** CodeMirror 6 (lighter than Monaco, better mobile)
- **Agent:** MCP server (TypeScript), Claude API integration
- **Build:** Vite + wasm-pack (Rust) or pre-built WASM modules

## Name

**Agent CAD** — because the agent is a first-class citizen, not a bolt-on.

---

*Created 2026-02-17 by Hardy Thomas + Claude*
*Updated 2026-02-17 — Phase 2 (SDF kernel) and Phase 3 (agent layer) complete. Theory grounded in token-native geometry research.*
*For the machinist who wants to build the machine beneath the machine.*
