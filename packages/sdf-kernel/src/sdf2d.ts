/**
 * SDF2D — 2D signed distance fields for profile-based geometry.
 *
 * 2D profiles are the bridge from engineering drawings to 3D:
 *   extrude(polygon([[0,0], [50,0], [50,30], [0,30]]), 20)
 *
 * Combine with Extrude (linear) or Revolve (rotational) in sdf.ts
 * to create 3D solids from 2D cross-sections.
 */

import type { Vec2 } from './vec3.js';

// ─── Bounding box ──────────────────────────────────────────────

export interface BoundingBox2D { min: Vec2; max: Vec2; }

// ─── Base class ────────────────────────────────────────────────

export abstract class SDF2D {
  /** Evaluate signed distance at point (x, y). Negative = inside. */
  abstract evaluate(x: number, y: number): number;

  /** Human-readable name for readback. */
  abstract get name(): string;

  /** Axis-aligned bounding box of the 2D shape. */
  abstract bounds2d(): BoundingBox2D;

  /** Test if point is inside (or on boundary of) the 2D shape. */
  contains(x: number, y: number): boolean {
    return this.evaluate(x, y) <= 0;
  }

  /** Readback for the LLM. */
  readback2d(): { name: string; bounds: BoundingBox2D; size: Vec2; center: Vec2 } {
    const b = this.bounds2d();
    return {
      name: this.name,
      bounds: b,
      size: [b.max[0] - b.min[0], b.max[1] - b.min[1]],
      center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2],
    };
  }
}

// ─── Polygon2D — exact SDF from vertex array ──────────────────

/**
 * Exact 2D polygon SDF using Quilez's edge-distance + winding-number algorithm.
 * Handles convex and concave polygons. Vertices in order (CW or CCW).
 * Minimum 3 vertices required.
 */
export class Polygon2D extends SDF2D {
  readonly kind = 'polygon2d' as const;
  private readonly verts: Vec2[];
  private readonly cachedBounds: BoundingBox2D;

  constructor(vertices: Vec2[]) {
    super();
    if (vertices.length < 3) {
      throw new Error('Polygon2D requires at least 3 vertices');
    }
    if (vertices.length > 10000) {
      throw new Error('Polygon2D supports at most 10,000 vertices');
    }
    this.verts = vertices.map(v => [v[0], v[1]] as Vec2);

    // Pre-compute bounds (immutable vertices → compute once)
    const v = this.verts;
    let minX = v[0][0], minY = v[0][1];
    let maxX = v[0][0], maxY = v[0][1];
    for (let i = 1; i < v.length; i++) {
      if (v[i][0] < minX) minX = v[i][0];
      if (v[i][1] < minY) minY = v[i][1];
      if (v[i][0] > maxX) maxX = v[i][0];
      if (v[i][1] > maxY) maxY = v[i][1];
    }
    this.cachedBounds = { min: [minX, minY], max: [maxX, maxY] };
  }

  get name(): string {
    return `polygon2d(${this.verts.length} vertices)`;
  }

  evaluate(px: number, py: number): number {
    const v = this.verts;
    const N = v.length;

    // Start with distance to first vertex
    let dx = px - v[0][0];
    let dy = py - v[0][1];
    let d = dx * dx + dy * dy; // min squared distance
    let s = 1.0;               // sign: +1 outside, -1 inside

    for (let i = 0, j = N - 1; i < N; j = i, i++) {
      // Edge vector: e = v[j] - v[i]
      const ex = v[j][0] - v[i][0];
      const ey = v[j][1] - v[i][1];
      // Point-to-edge-start vector: w = p - v[i]
      const wx = px - v[i][0];
      const wy = py - v[i][1];

      // Closest point on edge segment (clamped projection)
      const ee = ex * ex + ey * ey;
      const t = ee > 1e-12
        ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / ee))
        : 0;
      const bx = wx - ex * t;
      const by = wy - ey * t;
      d = Math.min(d, bx * bx + by * by);

      // Winding number sign flip (ray-casting along +Y)
      const c1 = py >= v[i][1];
      const c2 = py < v[j][1];
      const c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) {
        s = -s;
      }
    }

    return s * Math.sqrt(d);
  }

  bounds2d(): BoundingBox2D {
    return this.cachedBounds;
  }
}

// ─── Circle2D — exact ──────────────────────────────────────────

/** 2D circle centered at origin. Useful as a revolve profile. */
export class Circle2D extends SDF2D {
  readonly kind = 'circle2d' as const;

  constructor(readonly radius: number) {
    super();
    if (radius <= 0) throw new Error('Circle2D radius must be positive');
  }

  get name(): string {
    return `circle2d(r=${this.radius})`;
  }

  evaluate(x: number, y: number): number {
    return Math.sqrt(x * x + y * y) - this.radius;
  }

  bounds2d(): BoundingBox2D {
    const r = this.radius;
    return { min: [-r, -r], max: [r, r] };
  }
}

// ─── Rect2D — exact ───────────────────────────────────────────

/** 2D rectangle centered at origin. */
export class Rect2D extends SDF2D {
  readonly kind = 'rect2d' as const;
  readonly halfW: number;
  readonly halfH: number;

  constructor(readonly width: number, readonly height: number) {
    super();
    if (width <= 0 || height <= 0) throw new Error('Rect2D dimensions must be positive');
    this.halfW = width / 2;
    this.halfH = height / 2;
  }

  get name(): string {
    return `rect2d(${this.width}, ${this.height})`;
  }

  evaluate(x: number, y: number): number {
    const qx = Math.abs(x) - this.halfW;
    const qy = Math.abs(y) - this.halfH;
    return (
      Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) +
      Math.min(Math.max(qx, qy), 0)
    );
  }

  bounds2d(): BoundingBox2D {
    return { min: [-this.halfW, -this.halfH], max: [this.halfW, this.halfH] };
  }
}
