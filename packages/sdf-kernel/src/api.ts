/**
 * Fluent API — the DSL surface for LLMs and humans.
 *
 *   box(100, 60, 30).subtract(cylinder(5, 40).at(50, 30, 0))
 *
 * All functions return SDF nodes. Composition is just method chaining.
 */

import { SDF, Sphere, Box, Cylinder, Cone, Torus, Plane } from './sdf.js';
import type { Vec3 } from './vec3.js';

// ─── Primitive constructors ─────────────────────────────────

/** Axis-aligned box centered at origin. Dimensions in mm. */
export function box(width: number, height: number, depth: number): SDF {
  return new Box(width, height, depth);
}

/** Sphere centered at origin. */
export function sphere(radius: number): SDF {
  return new Sphere(radius);
}

/** Cylinder centered at origin, aligned along Z. */
export function cylinder(radius: number, height: number): SDF {
  return new Cylinder(radius, height);
}

/** Cone with tip at origin, opening downward. Base at -height. */
export function cone(radius: number, height: number): SDF {
  return new Cone(radius, height);
}

/** Torus centered at origin, in the XY plane. */
export function torus(majorRadius: number, minorRadius: number): SDF {
  return new Torus(majorRadius, minorRadius);
}

/** Infinite half-space. Points where dot(p, normal) < offset are inside. */
export function plane(normal: Vec3, offset: number): SDF {
  return new Plane(normal, offset);
}

// ─── Standalone boolean constructors ─────────────────────────

export function union(...shapes: SDF[]): SDF {
  return shapes.reduce((a, b) => a.union(b));
}

export function subtract(from: SDF, ...cutters: SDF[]): SDF {
  return cutters.reduce((a, b) => a.subtract(b), from);
}

export function intersect(...shapes: SDF[]): SDF {
  return shapes.reduce((a, b) => a.intersect(b));
}
