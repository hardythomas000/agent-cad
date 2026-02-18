/**
 * SDF Node — the core of the kernel.
 *
 * Every shape is an SDF node. Nodes compose via booleans and transforms.
 * The fluent API makes this LLM-friendly:
 *
 *   box(100, 60, 30).subtract(cylinder(5, 40).translate(50, 30, 0))
 *
 * Evaluation is exact — the function IS the geometry.
 */

import { Vec3, BoundingBox, vec3, add, sub, scale, dot, length, normalize, abs3, max3, len2d } from './vec3.js';
import type { SDF2D } from './sdf2d.js';

// ─── Base class ────────────────────────────────────────────────

export abstract class SDF {
  /** Evaluate signed distance at point p. Negative = inside. */
  abstract evaluate(p: Vec3): number;

  /** Human-readable name for readback. */
  abstract get name(): string;

  // ─── Gradient (surface normal) ─────────────────────────────

  /** Compute gradient via central differences. Override for analytical. */
  gradient(p: Vec3, eps = 1e-6): Vec3 {
    const dx = this.evaluate([p[0] + eps, p[1], p[2]]) - this.evaluate([p[0] - eps, p[1], p[2]]);
    const dy = this.evaluate([p[0], p[1] + eps, p[2]]) - this.evaluate([p[0], p[1] - eps, p[2]]);
    const dz = this.evaluate([p[0], p[1], p[2] + eps]) - this.evaluate([p[0], p[1], p[2] - eps]);
    const inv = 1 / (2 * eps);
    return normalize([dx * inv, dy * inv, dz * inv]);
  }

  /** Surface normal at a point (normalized gradient). */
  normal(p: Vec3): Vec3 {
    return this.gradient(p);
  }

  // ─── Root finding ──────────────────────────────────────────

  /**
   * Find the first surface (SDF=0) along a ray.
   *
   * Uses sphere tracing (adaptive ray marching) to find the first sign change,
   * then bisection refinement to the requested tolerance.
   * Returns the parameter t where origin + t*direction hits the surface,
   * or null if no intersection in [tMin, tMax].
   */
  findSurface(
    origin: Vec3,
    direction: Vec3,
    tMin: number,
    tMax: number,
    tolerance = 1e-7,
    maxIter = 128,
  ): number | null {
    const dl = length(direction);
    if (dl === 0) throw new Error('findSurface: direction must be non-zero');
    const dir: Vec3 = [direction[0] / dl, direction[1] / dl, direction[2] / dl];
    const at = (t: number): Vec3 => [
      origin[0] + t * dir[0],
      origin[1] + t * dir[1],
      origin[2] + t * dir[2],
    ];

    // Sphere tracing — step by SDF distance (adaptive).
    // When far from surface, |SDF| is large → big steps.
    // Near surface, |SDF| shrinks → precise convergence.
    let t = tMin;
    let d = this.evaluate(at(t));
    const minStep = (tMax - tMin) * 1e-6;

    for (let i = 0; i < maxIter && t < tMax; i++) {
      if (Math.abs(d) < tolerance) return t;

      const step = Math.max(Math.abs(d), minStep);
      const nextT = Math.min(t + step, tMax);
      const nextD = this.evaluate(at(nextT));

      // Sign change found — refine with bisection
      if (d * nextD < 0) {
        let lo = t, hi = nextT;
        let dLo = d;
        for (let j = 0; j < maxIter; j++) {
          const mid = (lo + hi) * 0.5;
          if (Math.abs(hi - lo) < tolerance) return mid;
          const dMid = this.evaluate(at(mid));
          if (dLo * dMid <= 0) {
            hi = mid;
          } else {
            lo = mid; dLo = dMid;
          }
        }
        return (lo + hi) * 0.5;
      }

      t = nextT;
      d = nextD;
    }

    return null;
  }

  /**
   * Drop cutter: find Z where tool contacts surface, searching downward.
   * For a point tool at (x, y), finds the Z where SDF = 0.
   * For ball-nose, offset SDF by tool radius first.
   * Returns the Z coordinate of the surface contact, or null if no hit.
   */
  dropCutter(x: number, y: number, zTop: number, zBottom: number, tolerance = 1e-7): number | null {
    const t = this.findSurface(
      [x, y, zTop],
      [0, 0, -1],
      0,
      zTop - zBottom,
      tolerance,
    );
    return t !== null ? zTop - t : null;
  }

  // ─── Queries ───────────────────────────────────────────────

  /** Test if point is inside (or on surface of) the shape. */
  contains(p: Vec3): boolean {
    return this.evaluate(p) <= 0;
  }

  /**
   * Estimate bounding box by sampling. For primitives, override with exact bounds.
   */
  bounds(searchRange = 500, resolution = 2): BoundingBox {
    let minB: Vec3 = [searchRange, searchRange, searchRange];
    let maxB: Vec3 = [-searchRange, -searchRange, -searchRange];
    let found = false;

    const step = resolution;
    for (let x = -searchRange; x <= searchRange; x += step) {
      for (let y = -searchRange; y <= searchRange; y += step) {
        for (let z = -searchRange; z <= searchRange; z += step) {
          if (this.evaluate([x, y, z]) <= 0) {
            found = true;
            if (x < minB[0]) minB[0] = x;
            if (y < minB[1]) minB[1] = y;
            if (z < minB[2]) minB[2] = z;
            if (x > maxB[0]) maxB[0] = x;
            if (y > maxB[1]) maxB[1] = y;
            if (z > maxB[2]) maxB[2] = z;
          }
        }
      }
    }

    if (!found) return { min: [0, 0, 0], max: [0, 0, 0] };

    return {
      min: [minB[0] - step, minB[1] - step, minB[2] - step],
      max: [maxB[0] + step, maxB[1] + step, maxB[2] + step],
    };
  }

  /**
   * Structured readback — the LLM's "eyes".
   */
  readback(): SDFReadback {
    const b = this.bounds();
    const size: Vec3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    return {
      name: this.name,
      bounds: b,
      size,
      center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
    };
  }

  // ─── Boolean operations (fluent) ───────────────────────────

  union(other: SDF): SDF { return new Union(this, other); }
  subtract(other: SDF): SDF { return new Subtract(this, other); }
  intersect(other: SDF): SDF { return new Intersect(this, other); }

  smoothUnion(other: SDF, k: number): SDF { return new SmoothUnion(this, other, k); }
  smoothSubtract(other: SDF, k: number): SDF { return new SmoothSubtract(this, other, k); }
  smoothIntersect(other: SDF, k: number): SDF { return new SmoothIntersect(this, other, k); }

  // ─── Transform operations (fluent) ─────────────────────────

  translate(x: number, y: number, z: number): SDF { return new Translate(this, [x, y, z]); }
  rotateX(deg: number): SDF { return new RotateAxis(this, 'x', deg); }
  rotateY(deg: number): SDF { return new RotateAxis(this, 'y', deg); }
  rotateZ(deg: number): SDF { return new RotateAxis(this, 'z', deg); }
  scale(factor: number): SDF { return new Scale(this, factor); }
  mirror(axis: 'x' | 'y' | 'z'): SDF { return new Mirror(this, axis); }

  // ─── Modifiers (fluent) ────────────────────────────────────

  shell(thickness: number): SDF { return new Shell(this, thickness); }
  round(radius: number): SDF { return new Round(this, radius); }
  elongate(x: number, y: number, z: number): SDF { return new Elongate(this, [x, y, z]); }

  // ─── Shorthand (fluent) ────────────────────────────────────

  /** Translate — alias for .translate() */
  at(x: number, y: number, z: number): SDF { return this.translate(x, y, z); }
}

// ─── Readback type ─────────────────────────────────────────────

export interface SDFReadback {
  name: string;
  bounds: BoundingBox;
  size: Vec3;
  center: Vec3;
}

// ─── Primitives ────────────────────────────────────────────────

export class Sphere extends SDF {
  readonly kind = 'sphere' as const;
  constructor(readonly radius: number) { super(); }
  get name() { return `sphere(r=${this.radius})`; }
  evaluate(p: Vec3): number {
    return length(p) - this.radius;
  }
  gradient(p: Vec3): Vec3 { return normalize(p); }
  bounds(): BoundingBox {
    const r = this.radius;
    return { min: vec3(-r, -r, -r), max: vec3(r, r, r) };
  }
}

export class Box extends SDF {
  readonly kind = 'box' as const;
  readonly half: Vec3;
  constructor(readonly w: number, readonly h: number, readonly d: number) {
    super();
    this.half = [w / 2, h / 2, d / 2];
  }
  get name() { return `box(${this.w}, ${this.h}, ${this.d})`; }
  evaluate(p: Vec3): number {
    const q: Vec3 = [
      Math.abs(p[0]) - this.half[0],
      Math.abs(p[1]) - this.half[1],
      Math.abs(p[2]) - this.half[2],
    ];
    return (
      length([Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)]) +
      Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0)
    );
  }
  bounds(): BoundingBox {
    return { min: vec3(-this.half[0], -this.half[1], -this.half[2]), max: vec3(this.half[0], this.half[1], this.half[2]) };
  }
}

export class Cylinder extends SDF {
  readonly kind = 'cylinder' as const;
  constructor(readonly radius: number, readonly height: number) { super(); }
  get name() { return `cylinder(r=${this.radius}, h=${this.height})`; }
  evaluate(p: Vec3): number {
    const halfH = this.height / 2;
    const d: [number, number] = [len2d(p[0], p[1]) - this.radius, Math.abs(p[2]) - halfH];
    return (
      Math.min(Math.max(d[0], d[1]), 0) +
      len2d(Math.max(d[0], 0), Math.max(d[1], 0))
    );
  }
  bounds(): BoundingBox {
    const r = this.radius, hh = this.height / 2;
    return { min: vec3(-r, -r, -hh), max: vec3(r, r, hh) };
  }
}

export class Cone extends SDF {
  readonly kind = 'cone' as const;
  constructor(readonly radius: number, readonly height: number) {
    super();
  }
  get name() { return `cone(r=${this.radius}, h=${this.height})`; }
  evaluate(p: Vec3): number {
    // Capped cone: tip at origin, opens downward along -Z, base at z=-height.
    // Based on Quilez's sdCappedCone using closest-point-on-boundary.
    const r = this.radius;
    const h = this.height;
    const q: [number, number] = [len2d(p[0], p[1]), p[2]];

    // Edge vector from tip (0,0) to base rim (r, -h)
    const ex = r, ey = -h;
    const elen2 = ex * ex + ey * ey;

    // Project q onto the slant edge (clamped to [0,1])
    const d2 = q[0] * ex + q[1] * ey;
    const t = Math.max(0, Math.min(1, d2 / elen2));
    const projX = t * ex;
    const projY = t * ey;
    const dSlant = len2d(q[0] - projX, q[1] - projY);

    // Distance to base cap disk (clamp radial to [0, r])
    const capR = Math.min(q[0], r);
    const dCap = len2d(capR - q[0], q[1] + h);

    const dist = Math.min(dSlant, dCap);

    // Sign: inside if below the slant line AND above the base
    const cross = q[1] * ex - q[0] * ey;
    const insideCone = cross <= 0 && q[1] >= -h && q[1] <= 0;
    return insideCone ? -dist : dist;
  }
  bounds(): BoundingBox {
    const r = this.radius;
    return { min: vec3(-r, -r, -this.height), max: vec3(r, r, 0) };
  }
}

export class Torus extends SDF {
  readonly kind = 'torus' as const;
  constructor(readonly majorRadius: number, readonly minorRadius: number) { super(); }
  get name() { return `torus(R=${this.majorRadius}, r=${this.minorRadius})`; }
  evaluate(p: Vec3): number {
    const q: [number, number] = [len2d(p[0], p[1]) - this.majorRadius, p[2]];
    return len2d(q[0], q[1]) - this.minorRadius;
  }
  bounds(): BoundingBox {
    const R = this.majorRadius, r = this.minorRadius;
    return { min: vec3(-R - r, -R - r, -r), max: vec3(R + r, R + r, r) };
  }
}

export class Plane extends SDF {
  readonly kind = 'plane' as const;
  private n: Vec3;
  constructor(normal: Vec3, readonly offset: number) {
    super();
    if (length(normal) === 0) throw new Error('Plane normal must be non-zero');
    this.n = normalize(normal);
  }
  get name() { return `plane([${this.n}], ${this.offset})`; }
  evaluate(p: Vec3): number {
    return dot(p, this.n) - this.offset;
  }
  gradient(_p: Vec3): Vec3 { return this.n; }
}

// ─── Boolean operations ────────────────────────────────────────

export class Union extends SDF {
  readonly kind = 'union' as const;
  constructor(readonly a: SDF, readonly b: SDF) { super(); }
  get name() { return `union(${this.a.name}, ${this.b.name})`; }
  evaluate(p: Vec3): number {
    return Math.min(this.a.evaluate(p), this.b.evaluate(p));
  }
  bounds(): BoundingBox {
    const ba = this.a.bounds(), bb = this.b.bounds();
    return {
      min: [Math.min(ba.min[0], bb.min[0]), Math.min(ba.min[1], bb.min[1]), Math.min(ba.min[2], bb.min[2])] as Vec3,
      max: [Math.max(ba.max[0], bb.max[0]), Math.max(ba.max[1], bb.max[1]), Math.max(ba.max[2], bb.max[2])] as Vec3,
    };
  }
}

export class Subtract extends SDF {
  readonly kind = 'subtract' as const;
  constructor(readonly a: SDF, readonly b: SDF) { super(); }
  get name() { return `subtract(${this.a.name}, ${this.b.name})`; }
  evaluate(p: Vec3): number {
    return Math.max(this.a.evaluate(p), -this.b.evaluate(p));
  }
  bounds(): BoundingBox {
    return this.a.bounds(); // Conservative: result fits within A
  }
}

export class Intersect extends SDF {
  readonly kind = 'intersect' as const;
  constructor(readonly a: SDF, readonly b: SDF) { super(); }
  get name() { return `intersect(${this.a.name}, ${this.b.name})`; }
  evaluate(p: Vec3): number {
    return Math.max(this.a.evaluate(p), this.b.evaluate(p));
  }
  bounds(): BoundingBox {
    const ba = this.a.bounds(), bb = this.b.bounds();
    return {
      min: [Math.max(ba.min[0], bb.min[0]), Math.max(ba.min[1], bb.min[1]), Math.max(ba.min[2], bb.min[2])] as Vec3,
      max: [Math.min(ba.max[0], bb.max[0]), Math.min(ba.max[1], bb.max[1]), Math.min(ba.max[2], bb.max[2])] as Vec3,
    };
  }
}

// Smooth booleans (polynomial smooth min/max)
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

export class SmoothUnion extends SDF {
  readonly kind = 'smoothUnion' as const;
  constructor(readonly a: SDF, readonly b: SDF, readonly k: number) { super(); }
  get name() { return `smoothUnion(${this.a.name}, ${this.b.name}, k=${this.k})`; }
  evaluate(p: Vec3): number {
    return smin(this.a.evaluate(p), this.b.evaluate(p), this.k);
  }
  bounds(): BoundingBox {
    const ba = this.a.bounds(), bb = this.b.bounds();
    const pad = this.k / 2;
    return {
      min: [Math.min(ba.min[0], bb.min[0]) - pad, Math.min(ba.min[1], bb.min[1]) - pad, Math.min(ba.min[2], bb.min[2]) - pad] as Vec3,
      max: [Math.max(ba.max[0], bb.max[0]) + pad, Math.max(ba.max[1], bb.max[1]) + pad, Math.max(ba.max[2], bb.max[2]) + pad] as Vec3,
    };
  }
}

export class SmoothSubtract extends SDF {
  readonly kind = 'smoothSubtract' as const;
  constructor(readonly a: SDF, readonly b: SDF, readonly k: number) { super(); }
  get name() { return `smoothSubtract(${this.a.name}, ${this.b.name}, k=${this.k})`; }
  evaluate(p: Vec3): number {
    return smax(this.a.evaluate(p), -this.b.evaluate(p), this.k);
  }
  bounds(): BoundingBox {
    return this.a.bounds();
  }
}

export class SmoothIntersect extends SDF {
  readonly kind = 'smoothIntersect' as const;
  constructor(readonly a: SDF, readonly b: SDF, readonly k: number) { super(); }
  get name() { return `smoothIntersect(${this.a.name}, ${this.b.name}, k=${this.k})`; }
  evaluate(p: Vec3): number {
    return smax(this.a.evaluate(p), this.b.evaluate(p), this.k);
  }
  bounds(): BoundingBox {
    const ba = this.a.bounds(), bb = this.b.bounds();
    return {
      min: [Math.max(ba.min[0], bb.min[0]), Math.max(ba.min[1], bb.min[1]), Math.max(ba.min[2], bb.min[2])] as Vec3,
      max: [Math.min(ba.max[0], bb.max[0]), Math.min(ba.max[1], bb.max[1]), Math.min(ba.max[2], bb.max[2])] as Vec3,
    };
  }
}

// ─── Transforms ────────────────────────────────────────────────

export class Translate extends SDF {
  readonly kind = 'translate' as const;
  constructor(readonly child: SDF, readonly offset: Vec3) { super(); }
  get name() { return `${this.child.name}.translate(${this.offset})`; }
  evaluate(p: Vec3): number {
    return this.child.evaluate(sub(p, this.offset));
  }
  bounds(): BoundingBox {
    const cb = this.child.bounds();
    return {
      min: add(cb.min, this.offset),
      max: add(cb.max, this.offset),
    };
  }
}

export class RotateAxis extends SDF {
  readonly kind = 'rotateAxis' as const;
  private readonly c: number;
  private readonly s: number;
  constructor(readonly child: SDF, readonly axis: 'x' | 'y' | 'z', readonly deg: number) {
    super();
    const rad = deg * Math.PI / 180;
    this.c = Math.cos(-rad);
    this.s = Math.sin(-rad);
  }
  get name() { return `${this.child.name}.rotate${this.axis.toUpperCase()}(${this.deg})`; }
  /** Rotate point by the forward rotation (inverse of the evaluate transform). */
  private rotateForward(p: Vec3): Vec3 {
    const c = this.c, s = -this.s;
    switch (this.axis) {
      case 'x': return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
      case 'y': return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
      case 'z': return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
    }
  }
  evaluate(p: Vec3): number {
    const { c, s } = this;
    let rp: Vec3;
    switch (this.axis) {
      case 'x': rp = [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]; break;
      case 'y': rp = [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]; break;
      case 'z': rp = [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]; break;
    }
    return this.child.evaluate(rp);
  }
  bounds(): BoundingBox {
    const cb = this.child.bounds();
    // Rotate all 8 corners of child AABB, take new AABB
    const corners: Vec3[] = [];
    for (const x of [cb.min[0], cb.max[0]])
      for (const y of [cb.min[1], cb.max[1]])
        for (const z of [cb.min[2], cb.max[2]])
          corners.push(this.rotateForward([x, y, z]));
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const c of corners) {
      for (let i = 0; i < 3; i++) {
        if (c[i] < min[i]) min[i] = c[i];
        if (c[i] > max[i]) max[i] = c[i];
      }
    }
    return { min, max };
  }
}

export class Scale extends SDF {
  readonly kind = 'scale' as const;
  constructor(readonly child: SDF, readonly factor: number) {
    super();
    if (factor === 0) throw new Error('Scale factor cannot be zero');
    if (factor < 0) throw new Error('Scale factor must be positive');
  }
  get name() { return `${this.child.name}.scale(${this.factor})`; }
  evaluate(p: Vec3): number {
    return this.child.evaluate(scale(p, 1 / this.factor)) * this.factor;
  }
  bounds(): BoundingBox {
    const cb = this.child.bounds();
    return {
      min: scale(cb.min, this.factor),
      max: scale(cb.max, this.factor),
    };
  }
}

export class Mirror extends SDF {
  readonly kind = 'mirror' as const;
  constructor(readonly child: SDF, readonly axis: 'x' | 'y' | 'z') { super(); }
  get name() { return `${this.child.name}.mirror(${this.axis})`; }
  evaluate(p: Vec3): number {
    const mp: Vec3 = this.axis === 'x'
      ? [Math.abs(p[0]), p[1], p[2]]
      : this.axis === 'y'
        ? [p[0], Math.abs(p[1]), p[2]]
        : [p[0], p[1], Math.abs(p[2])];
    return this.child.evaluate(mp);
  }
  bounds(): BoundingBox {
    const cb = this.child.bounds();
    const i = this.axis === 'x' ? 0 : this.axis === 'y' ? 1 : 2;
    const min: Vec3 = [...cb.min];
    const max: Vec3 = [...cb.max];
    const extent = Math.max(Math.abs(cb.min[i]), Math.abs(cb.max[i]));
    min[i] = -extent;
    max[i] = extent;
    return { min, max };
  }
}

// ─── Modifiers ─────────────────────────────────────────────────

export class Shell extends SDF {
  readonly kind = 'shell' as const;
  constructor(readonly child: SDF, readonly thickness: number) { super(); }
  get name() { return `${this.child.name}.shell(${this.thickness})`; }
  evaluate(p: Vec3): number {
    return Math.abs(this.child.evaluate(p)) - this.thickness / 2;
  }
}

export class Round extends SDF {
  readonly kind = 'round' as const;
  constructor(readonly child: SDF, readonly radius: number) { super(); }
  get name() { return `${this.child.name}.round(${this.radius})`; }
  evaluate(p: Vec3): number {
    return this.child.evaluate(p) - this.radius;
  }
}

export class Elongate extends SDF {
  readonly kind = 'elongate' as const;
  private half: Vec3;
  constructor(readonly child: SDF, readonly amount: Vec3) {
    super();
    this.half = [amount[0] / 2, amount[1] / 2, amount[2] / 2];
  }
  get name() { return `${this.child.name}.elongate(${this.amount})`; }
  evaluate(p: Vec3): number {
    const q: Vec3 = [
      p[0] - Math.max(-this.half[0], Math.min(p[0], this.half[0])),
      p[1] - Math.max(-this.half[1], Math.min(p[1], this.half[1])),
      p[2] - Math.max(-this.half[2], Math.min(p[2], this.half[2])),
    ];
    return this.child.evaluate(q);
  }
}

// ─── 2D → 3D Bridge ────────────────────────────────────────────

/**
 * Linear extrude: create a 3D solid by extruding a 2D profile along Z.
 * Centered: extends from -height/2 to +height/2.
 *
 * Uses Quilez's exact extrusion formula (not naive max) which correctly
 * handles edge/corner distances where the profile meets the caps.
 */
export class Extrude extends SDF {
  readonly kind = 'extrude' as const;
  private readonly halfH: number;

  constructor(readonly profile: SDF2D, readonly height: number) {
    super();
    if (height <= 0) throw new Error('Extrude height must be positive');
    this.halfH = height / 2;
  }

  get name() { return `extrude(${this.profile.name}, h=${this.height})`; }

  evaluate(p: Vec3): number {
    const d = this.profile.evaluate(p[0], p[1]);
    const wz = Math.abs(p[2]) - this.halfH;

    // Quilez's exact extrusion: treats (d, wz) as a 2D point
    // and computes distance to the quadrant where both <= 0
    return Math.min(Math.max(d, wz), 0.0) +
      Math.sqrt(Math.max(d, 0) ** 2 + Math.max(wz, 0) ** 2);
  }

  bounds(): BoundingBox {
    const b2 = this.profile.bounds2d();
    return {
      min: vec3(b2.min[0], b2.min[1], -this.halfH),
      max: vec3(b2.max[0], b2.max[1], this.halfH),
    };
  }
}

/**
 * Revolve: create a 3D solid by revolving a 2D profile around the Z axis.
 * The 2D profile is evaluated in (r - offset, z) space where r = sqrt(x²+y²).
 *
 * offset = 0: profile's X axis maps to radial distance.
 * offset > 0: profile is displaced outward from the Z axis.
 *
 * Example: circle2d(10) revolved at offset=30 → torus(R=30, r=10)
 */
export class Revolve extends SDF {
  readonly kind = 'revolve' as const;

  constructor(readonly profile: SDF2D, readonly offset: number) {
    super();
    if (offset < 0) throw new Error('Revolve offset must be non-negative');
  }

  get name() { return `revolve(${this.profile.name}, offset=${this.offset})`; }

  evaluate(p: Vec3): number {
    const r = len2d(p[0], p[1]);
    return this.profile.evaluate(r - this.offset, p[2]);
  }

  bounds(): BoundingBox {
    const b2 = this.profile.bounds2d();
    const rMin = this.offset + b2.min[0];
    const rMax = this.offset + b2.max[0];
    const maxR = Math.max(Math.abs(rMin), Math.abs(rMax));
    return {
      min: vec3(-maxR, -maxR, b2.min[1]),
      max: vec3(maxR, maxR, b2.max[1]),
    };
  }
}
