/**
 * Shape Registry — in-memory named shape store.
 *
 * Every mutating MCP tool stores its result here and returns
 * a structured readback so the LLM always knows the current state.
 */

import type { SDF, SDFReadback, TriangleMesh, ToolDefinition, ToolpathResult } from '@agent-cad/sdf-kernel';

export interface ShapeEntry {
  id: string;
  shape: SDF;
  type: string;
}

export interface ShapeResult {
  shape_id: string;
  type: string;
  readback: SDFReadback;
}

let nextId = 1;

const shapes = new Map<string, ShapeEntry>();

/** Store a shape and return its ID + readback. */
export function create(shape: SDF, type: string, name?: string): ShapeResult {
  if (name !== undefined && !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid shape name "${name}". Use only letters, digits, hyphens, underscores.`
    );
  }
  const id = name ?? `shape_${nextId++}`;
  if (shapes.has(id) && !name) {
    // Auto-generated collision — bump
    return create(shape, type);
  }
  if (shapes.has(id)) {
    meshCache.delete(id); // Invalidate stale mesh when overwriting a shape
  }
  shapes.set(id, { id, shape, type });
  return {
    shape_id: id,
    type,
    readback: shape.readback(),
  };
}

/** Retrieve a shape or throw a clear error. */
export function get(id: string): ShapeEntry {
  const entry = shapes.get(id);
  if (!entry) {
    const available = [...shapes.keys()];
    throw new Error(
      `Shape "${id}" not found. Available shapes: [${available.join(', ')}]`
    );
  }
  return entry;
}

/** Remove a shape and its cached mesh from the registry. */
export function remove(id: string): void {
  if (!shapes.has(id)) {
    throw new Error(`Shape "${id}" not found — cannot delete.`);
  }
  shapes.delete(id);
  meshCache.delete(id);
}

/** Check if a shape exists. */
export function has(id: string): boolean {
  return shapes.has(id);
}

/** List all shapes with their readbacks. */
export function list(): ShapeResult[] {
  return [...shapes.values()].map((entry) => ({
    shape_id: entry.id,
    type: entry.type,
    readback: entry.shape.readback(),
  }));
}

// ─── Mesh cache (separate from shape entries) ─────────────────

const meshCache = new Map<string, TriangleMesh>();

/** Cache a computed mesh for a shape. */
export function cacheMesh(shapeId: string, mesh: TriangleMesh): void {
  meshCache.set(shapeId, mesh);
}

/** Get cached mesh for a shape, or null. */
export function getMesh(shapeId: string): TriangleMesh | null {
  return meshCache.get(shapeId) ?? null;
}

/** Clear all shapes and mesh cache (for testing). */
export function clear(): void {
  shapes.clear();
  meshCache.clear();
  tools.clear();
  toolpaths.clear();
  nextId = 1;
  nextToolId = 1;
  nextToolpathId = 1;
}

// ─── Tool registry ──────────────────────────────────────────────

export interface ToolEntry {
  id: string;
  tool: ToolDefinition;
}

export interface ToolResult {
  tool_id: string;
  type: string;
  readback: {
    name: string;
    diameter_mm: number;
    radius_mm: number;
    flute_length_mm?: number;
    shank_diameter_mm?: number;
  };
}

let nextToolId = 1;
const tools = new Map<string, ToolEntry>();

export function createTool(tool: ToolDefinition, name?: string): ToolResult {
  if (name !== undefined && !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid tool name "${name}". Use only letters, digits, hyphens, underscores.`);
  }
  const id = name ?? `tool_${nextToolId++}`;
  if (tools.has(id) && name) {
    throw new Error(`Tool "${id}" already exists. Use a different name or delete the existing tool.`);
  }
  tools.set(id, { id, tool: { ...tool, name: id } });
  return {
    tool_id: id,
    type: tool.type,
    readback: {
      name: `${id} ${tool.type} D${tool.diameter}`,
      diameter_mm: tool.diameter,
      radius_mm: tool.radius,
      flute_length_mm: tool.flute_length,
      shank_diameter_mm: tool.shank_diameter,
    },
  };
}

export function getTool(id: string): ToolDefinition {
  const entry = tools.get(id);
  if (!entry) {
    const available = [...tools.keys()];
    throw new Error(`Tool "${id}" not found. Available tools: [${available.join(', ')}]`);
  }
  return entry.tool;
}

export function listTools(): ToolResult[] {
  return [...tools.values()].map((entry) => ({
    tool_id: entry.id,
    type: entry.tool.type,
    readback: {
      name: `${entry.id} ${entry.tool.type} D${entry.tool.diameter}`,
      diameter_mm: entry.tool.diameter,
      radius_mm: entry.tool.radius,
      flute_length_mm: entry.tool.flute_length,
      shank_diameter_mm: entry.tool.shank_diameter,
    },
  }));
}

// ─── Toolpath registry ──────────────────────────────────────────

export interface ToolpathSummary {
  toolpath_id: string;
  type: string;
  readback: {
    name: string;
    shape: string;
    tool: string;
    point_count: number;
    pass_count: number;
    z_range: [number, number];
    cut_distance_mm: number;
    rapid_distance_mm: number;
    estimated_time_min: number;
    stepover_mm: number;
  };
}

let nextToolpathId = 1;
const toolpaths = new Map<string, ToolpathResult>();

export function createToolpath(toolpath: ToolpathResult, name?: string): ToolpathSummary {
  if (name !== undefined && !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid toolpath name "${name}". Use only letters, digits, hyphens, underscores.`);
  }
  const id = name ?? `tp_${nextToolpathId++}`;
  const stored = { ...toolpath, id };
  toolpaths.set(id, stored);

  const stepoverMm = toolpath.tool.diameter * (toolpath.params.stepover_pct / 100);
  return {
    toolpath_id: id,
    type: 'surfacing',
    readback: {
      name: `raster_${toolpath.params.direction}_${toolpath.tool.name}`,
      shape: toolpath.shape_name,
      tool: `${toolpath.tool.name} ${toolpath.tool.type} D${toolpath.tool.diameter}`,
      point_count: toolpath.stats.point_count,
      pass_count: toolpath.stats.pass_count,
      z_range: [toolpath.stats.z_min, toolpath.stats.z_max],
      cut_distance_mm: toolpath.stats.cut_distance_mm,
      rapid_distance_mm: toolpath.stats.rapid_distance_mm,
      estimated_time_min: toolpath.stats.estimated_time_min,
      stepover_mm: Math.round(stepoverMm * 1000) / 1000,
    },
  };
}

export function getToolpath(id: string): ToolpathResult {
  const tp = toolpaths.get(id);
  if (!tp) {
    const available = [...toolpaths.keys()];
    throw new Error(`Toolpath "${id}" not found. Available toolpaths: [${available.join(', ')}]`);
  }
  return tp;
}

export function listToolpaths(): ToolpathSummary[] {
  return [...toolpaths.values()].map((tp) => {
    const stepoverMm = tp.tool.diameter * (tp.params.stepover_pct / 100);
    return {
      toolpath_id: tp.id,
      type: 'surfacing',
      readback: {
        name: `raster_${tp.params.direction}_${tp.tool.name}`,
        shape: tp.shape_name,
        tool: `${tp.tool.name} ${tp.tool.type} D${tp.tool.diameter}`,
        point_count: tp.stats.point_count,
        pass_count: tp.stats.pass_count,
        z_range: [tp.stats.z_min, tp.stats.z_max],
        cut_distance_mm: tp.stats.cut_distance_mm,
        rapid_distance_mm: tp.stats.rapid_distance_mm,
        estimated_time_min: tp.stats.estimated_time_min,
        stepover_mm: Math.round(stepoverMm * 1000) / 1000,
      },
    };
  });
}
