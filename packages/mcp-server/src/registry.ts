/**
 * Shape Registry — in-memory named shape store.
 *
 * Every mutating MCP tool stores its result here and returns
 * a structured readback so the LLM always knows the current state.
 */

import type { SDF, SDFReadback } from '@agent-cad/sdf-kernel';

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
  const id = name ?? `shape_${nextId++}`;
  if (shapes.has(id) && !name) {
    // Auto-generated collision — bump
    return create(shape, type);
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

/** Remove a shape from the registry. */
export function remove(id: string): void {
  if (!shapes.has(id)) {
    throw new Error(`Shape "${id}" not found — cannot delete.`);
  }
  shapes.delete(id);
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

/** Clear all shapes (for testing). */
export function clear(): void {
  shapes.clear();
  nextId = 1;
}
