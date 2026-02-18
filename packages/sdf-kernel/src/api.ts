/**
 * Fluent API — the DSL surface for LLMs and humans.
 *
 *   box(100, 60, 30).subtract(cylinder(5, 40).at(50, 30, 0))
 *
 * All functions return SDF nodes. Composition is just method chaining.
 */

import { SDF, Sphere, Box, Cylinder, Cone, Torus, Plane, Extrude, Revolve } from './sdf.js';
import { type SDF2D, Polygon2D, Circle2D, Rect2D } from './sdf2d.js';
import type { Vec2, Vec3 } from './vec3.js';

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
  if (shapes.length === 0) throw new Error('union requires at least one shape');
  return shapes.reduce((a, b) => a.union(b));
}

export function subtract(from: SDF, ...cutters: SDF[]): SDF {
  return cutters.reduce((a, b) => a.subtract(b), from);
}

export function intersect(...shapes: SDF[]): SDF {
  if (shapes.length === 0) throw new Error('intersect requires at least one shape');
  return shapes.reduce((a, b) => a.intersect(b));
}

// ─── 2D Profile constructors ──────────────────────────────────

/** 2D polygon profile from vertices. Min 3 vertices. Handles convex + concave. */
export function polygon(vertices: Vec2[]): SDF2D {
  return new Polygon2D(vertices);
}

/** 2D circle centered at origin. */
export function circle2d(radius: number): SDF2D {
  return new Circle2D(radius);
}

/** 2D rectangle centered at origin. */
export function rect2d(width: number, height: number): SDF2D {
  return new Rect2D(width, height);
}

// ─── 2D → 3D constructors ─────────────────────────────────────

/** Extrude a 2D profile along Z by height (centered at z=0). */
export function extrude(profile: SDF2D, height: number): SDF {
  return new Extrude(profile, height);
}

/** Revolve a 2D profile around the Z axis. Offset = distance from axis. */
export function revolve(profile: SDF2D, offset = 0): SDF {
  return new Revolve(profile, offset);
}
