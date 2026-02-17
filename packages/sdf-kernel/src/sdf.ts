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

import { Vec3, vec3, add, sub, scale, dot, length, normalize, abs3, max3, len2d } from './vec3.js';

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
   * Uses sphere tracing (ray marching) to find the first sign change,
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
    const dir = normalize(direction);
    const at = (t: number): Vec3 => [
      origin[0] + t * dir[0],
      origin[1] + t * dir[1],
      origin[2] + t * dir[2],
    ];

    // Phase 1: Ray march to find a bracket [tA, tB] containing a sign change.
    // Step in small increments; use the SDF value for adaptive stepping when far.
    const marchSteps = 256;
    const step = (tMax - tMin) / marchSteps;
    let prevT = tMin;
    let prevD = this.evaluate(at(tMin));

    for (let i = 1; i <= marchSteps; i++) {
      const t = tMin + i * step;
      const d = this.evaluate(at(t));

      if (prevD * d < 0) {
        // Sign change found — refine with bisection
        let lo = prevT, hi = t;
        // Ensure lo has negative SDF (inside), hi has positive (outside)
        if (prevD > 0) { lo = t; hi = prevT; }

        for (let j = 0; j < maxIter; j++) {
          const mid = (lo + hi) * 0.5;
          if (Math.abs(hi - lo) < tolerance) return mid;
          const dMid = this.evaluate(at(mid));
          if (dMid < 0) lo = mid;
          else hi = mid;
        }
        return (lo + hi) * 0.5;
      }

      // Also detect near-zero (on surface)
      if (Math.abs(d) < tolerance) return t;

      prevT = t;
      prevD = d;
    }

    return null; // No intersection found
  }

  /**
   * Drop cutter: find Z where tool contacts surface, searching downward.
   * For a point tool at (x, y), finds the Z where SDF = 0.
   * For ball-nose, offset SDF by tool radius first.
   */
  dropCutter(x: number, y: number, zTop: number, zBottom: number, tolerance = 1e-7): number | null {
    return this.findSurface(
      [x, y, zTop],
      [0, 0, -1],
      0,
      zTop - zBottom,
      tolerance,
    );
  }

  // ─── Queries ───────────────────────────────────────────────

  /** Test if point is inside (or on surface of) the shape. */
  contains(p: Vec3): boolean {
    return this.evaluate(p) <= 0;
  }

  /**
   * Estimate bounding box by sampling. For primitives, override with exact bounds.
   * Returns { min: Vec3, max: Vec3 }.
   */
  bounds(searchRange = 500, resolution = 2): { min: Vec3; max: Vec3 } {
    let minB: Vec3 = [searchRange, searchRange, searchRange];
    let maxB: Vec3 = [-searchRange, -searchRange, -searchRange];
    let found = false;

    // Coarse pass: find approximate bounds
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

    // Pad by one step (we might have missed the true boundary)
    return {
      min: [minB[0] - step, minB[1] - step, minB[2] - step],
      max: [maxB[0] + step, maxB[1] + step, maxB[2] + step],
    };
  }

  /**
   * Structured readback — the LLM's "eyes".
   * Returns a text description of the current state.
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
  bounds: { min: Vec3; max: Vec3 };
  size: Vec3;
  center: Vec3;
}

// ─── Primitives ────────────────────────────────────────────────

export class Sphere extends SDF {
  constructor(readonly radius: number) { super(); }
  get name() { return `sphere(r=${this.radius})`; }
  evaluate(p: Vec3): number {
    return length(p) - this.radius;
  }
  bounds() {
    const r = this.radius;
    return { min: vec3(-r, -r, -r), max: vec3(r, r, r) };
  }
}

export class Box extends SDF {
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
  bounds() {
    return { min: vec3(-this.half[0], -this.half[1], -this.half[2]), max: vec3(this.half[0], this.half[1], this.half[2]) };
  }
}

export class Cylinder extends SDF {
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
  bounds() {
    const r = this.radius, hh = this.height / 2;
    return { min: vec3(-r, -r, -hh), max: vec3(r, r, hh) };
  }
}

export class Cone extends SDF {
  private sinA: number;
  private cosA: number;
  constructor(readonly radius: number, readonly height: number) {
    super();
    const a = Math.atan2(radius, height);
    this.sinA = Math.sin(a);
    this.cosA = Math.cos(a);
  }
  get name() { return `cone(r=${this.radius}, h=${this.height})`; }
  evaluate(p: Vec3): number {
    // Cone tip at origin, opens downward along -Z, base at z=-height
    const q: [number, number] = [len2d(p[0], p[1]), p[2]];
    // Signed distance to cone surface
    const tip: [number, number] = [0, 0];
    const base: [number, number] = [this.radius, -this.height];
    // Project onto cone line
    const e: [number, number] = [base[0] - tip[0], base[1] - tip[1]];
    const w: [number, number] = [q[0] - tip[0], q[1] - tip[1]];
    const d1 = w[1] * e[0] - w[0] * e[1];
    const d2 = w[0] * e[0] + w[1] * e[1];
    const le = len2d(e[0], e[1]);
    const t = Math.max(0, Math.min(1, d2 / (le * le)));
    const proj: [number, number] = [tip[0] + t * e[0], tip[1] + t * e[1]];
    const dSurf = len2d(q[0] - proj[0], q[1] - proj[1]);
    // Cap at base
    const dCap = Math.abs(q[1] + this.height) - 0;
    const insideCone = d1 <= 0 && q[1] >= -this.height && q[1] <= 0;
    const sign = insideCone ? -1 : 1;
    if (q[1] > 0) return length([q[0], q[1], 0]); // above tip
    if (q[1] < -this.height) {
      // below base
      const dR = q[0] - this.radius;
      if (dR > 0) return len2d(dR, q[1] + this.height);
      return -(q[1] + this.height);
    }
    return sign * dSurf;
  }
  bounds() {
    const r = this.radius;
    return { min: vec3(-r, -r, -this.height), max: vec3(r, r, 0) };
  }
}

export class Torus extends SDF {
  constructor(readonly majorRadius: number, readonly minorRadius: number) { super(); }
  get name() { return `torus(R=${this.majorRadius}, r=${this.minorRadius})`; }
  evaluate(p: Vec3): number {
    const q: [number, number] = [len2d(p[0], p[1]) - this.majorRadius, p[2]];
    return len2d(q[0], q[1]) - this.minorRadius;
  }
  bounds() {
    const R = this.majorRadius, r = this.minorRadius;
    return { min: vec3(-R - r, -R - r, -r), max: vec3(R + r, R + r, r) };
  }
}

export class Plane extends SDF {
  private n: Vec3;
  constructor(normal: Vec3, readonly offset: number) {
    super();
    this.n = normalize(normal);
  }
  get name() { return `plane([${this.n}], ${this.offset})`; }
  evaluate(p: Vec3): number {
    return dot(p, this.n) - this.offset;
  }
}

// ─── Boolean operations ────────────────────────────────────────

export class Union extends SDF {
  constructor(readonly a: SDF, readonly b: SDF) { super(); }
  get name() { return `union(${this.a.name}, ${this.b.name})`; }
  evaluate(p: Vec3): number {
    return Math.min(this.a.evaluate(p), this.b.evaluate(p));
  }
}

export class Subtract extends SDF {
  constructor(readonly a: SDF, readonly b: SDF) { super(); }
  get name() { return `subtract(${this.a.name}, ${this.b.name})`; }
  evaluate(p: Vec3): number {
    return Math.max(this.a.evaluate(p), -this.b.evaluate(p));
  }
}

export class Intersect extends SDF {
  constructor(readonly a: SDF, readonly b: SDF) { super(); }
  get name() { return `intersect(${this.a.name}, ${this.b.name})`; }
  evaluate(p: Vec3): number {
    return Math.max(this.a.evaluate(p), this.b.evaluate(p));
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
  constructor(readonly a: SDF, readonly b: SDF, readonly k: number) { super(); }
  get name() { return `smoothUnion(${this.a.name}, ${this.b.name}, k=${this.k})`; }
  evaluate(p: Vec3): number {
    return smin(this.a.evaluate(p), this.b.evaluate(p), this.k);
  }
}

export class SmoothSubtract extends SDF {
  constructor(readonly a: SDF, readonly b: SDF, readonly k: number) { super(); }
  get name() { return `smoothSubtract(${this.a.name}, ${this.b.name}, k=${this.k})`; }
  evaluate(p: Vec3): number {
    return smax(this.a.evaluate(p), -this.b.evaluate(p), this.k);
  }
}

export class SmoothIntersect extends SDF {
  constructor(readonly a: SDF, readonly b: SDF, readonly k: number) { super(); }
  get name() { return `smoothIntersect(${this.a.name}, ${this.b.name}, k=${this.k})`; }
  evaluate(p: Vec3): number {
    return smax(this.a.evaluate(p), this.b.evaluate(p), this.k);
  }
}

// ─── Transforms ────────────────────────────────────────────────

export class Translate extends SDF {
  constructor(readonly child: SDF, readonly offset: Vec3) { super(); }
  get name() { return `${this.child.name}.translate(${this.offset})`; }
  evaluate(p: Vec3): number {
    return this.child.evaluate(sub(p, this.offset));
  }
  bounds() {
    const cb = this.child.bounds();
    return {
      min: add(cb.min, this.offset),
      max: add(cb.max, this.offset),
    };
  }
}

export class RotateAxis extends SDF {
  private rad: number;
  constructor(readonly child: SDF, readonly axis: 'x' | 'y' | 'z', readonly deg: number) {
    super();
    this.rad = deg * Math.PI / 180;
  }
  get name() { return `${this.child.name}.rotate${this.axis.toUpperCase()}(${this.deg})`; }
  evaluate(p: Vec3): number {
    const c = Math.cos(-this.rad), s = Math.sin(-this.rad);
    let rp: Vec3;
    switch (this.axis) {
      case 'x': rp = [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]; break;
      case 'y': rp = [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]; break;
      case 'z': rp = [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]; break;
    }
    return this.child.evaluate(rp);
  }
}

export class Scale extends SDF {
  constructor(readonly child: SDF, readonly factor: number) { super(); }
  get name() { return `${this.child.name}.scale(${this.factor})`; }
  evaluate(p: Vec3): number {
    return this.child.evaluate(scale(p, 1 / this.factor)) * this.factor;
  }
  bounds() {
    const cb = this.child.bounds();
    return {
      min: scale(cb.min, this.factor),
      max: scale(cb.max, this.factor),
    };
  }
}

export class Mirror extends SDF {
  constructor(readonly child: SDF, readonly axis: 'x' | 'y' | 'z') { super(); }
  get name() { return `${this.child.name}.mirror(${this.axis})`; }
  evaluate(p: Vec3): number {
    const mp: Vec3 = [...p];
    const i = this.axis === 'x' ? 0 : this.axis === 'y' ? 1 : 2;
    mp[i] = Math.abs(mp[i]);
    return this.child.evaluate(mp);
  }
}

// ─── Modifiers ─────────────────────────────────────────────────

export class Shell extends SDF {
  constructor(readonly child: SDF, readonly thickness: number) { super(); }
  get name() { return `${this.child.name}.shell(${this.thickness})`; }
  evaluate(p: Vec3): number {
    return Math.abs(this.child.evaluate(p)) - this.thickness / 2;
  }
}

export class Round extends SDF {
  constructor(readonly child: SDF, readonly radius: number) { super(); }
  get name() { return `${this.child.name}.round(${this.radius})`; }
  evaluate(p: Vec3): number {
    return this.child.evaluate(p) - this.radius;
  }
}

export class Elongate extends SDF {
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
