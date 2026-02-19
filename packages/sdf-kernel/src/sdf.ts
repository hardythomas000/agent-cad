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
import { type SDF2D, Circle2D, Rect2D } from './sdf2d.js';
import type { FaceDescriptor, EdgeDescriptor } from './topology.js';

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
  subtract(other: SDF, featureName?: string): SDF { return new Subtract(this, other, featureName); }
  intersect(other: SDF): SDF { return new Intersect(this, other); }

  smoothUnion(other: SDF, k: number): SDF { return new SmoothUnion(this, other, k); }
  smoothSubtract(other: SDF, k: number, featureName?: string): SDF { return new SmoothSubtract(this, other, k, featureName); }
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

  // ─── Topology (named faces/edges) ──────────────────────────

  /** Return all named faces of this shape. Override in subclasses. */
  faces(): FaceDescriptor[] { return []; }

  /** Get a specific face by name. Throws if not found. */
  face(name: string): FaceDescriptor {
    const all = this.faces();
    const f = all.find(fd => fd.name === name);
    if (!f) {
      throw new Error(
        `Face "${name}" not found. Available faces: [${all.map(fd => fd.name).join(', ')}]`
      );
    }
    return f;
  }

  /** Return all edges (pairs of adjacent faces). Override in subclasses. */
  edges(): EdgeDescriptor[] { return []; }

  /** Get edge at intersection of two named faces. */
  edge(face1: string, face2: string): EdgeDescriptor {
    const all = this.edges();
    const e = all.find(ed =>
      (ed.faces[0] === face1 && ed.faces[1] === face2) ||
      (ed.faces[0] === face2 && ed.faces[1] === face1)
    );
    if (!e) {
      throw new Error(
        `Edge between "${face1}" and "${face2}" not found. ` +
        `This shape has ${all.length} edge(s): [${all.map(ed => ed.name).join(', ')}]`
      );
    }
    return e;
  }

  /** Classify which face a surface point belongs to. Returns null if unknown. */
  classifyPoint(_p: Vec3): string | null { return null; }

  /** Get direct SDF children (for tree traversal). */
  children(): SDF[] { return []; }
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
  faces(): FaceDescriptor[] {
    return [{ name: 'surface', normal: [1, 0, 0], kind: 'spherical', radius: this.radius }];
  }
  classifyPoint(_p: Vec3): string | null { return 'surface'; }
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
  faces(): FaceDescriptor[] {
    const [hx, hy, hz] = this.half;
    return [
      { name: 'right',  normal: [1, 0, 0],  kind: 'planar', origin: [hx, 0, 0] },
      { name: 'left',   normal: [-1, 0, 0], kind: 'planar', origin: [-hx, 0, 0] },
      { name: 'top',    normal: [0, 1, 0],  kind: 'planar', origin: [0, hy, 0] },
      { name: 'bottom', normal: [0, -1, 0], kind: 'planar', origin: [0, -hy, 0] },
      { name: 'front',  normal: [0, 0, 1],  kind: 'planar', origin: [0, 0, hz] },
      { name: 'back',   normal: [0, 0, -1], kind: 'planar', origin: [0, 0, -hz] },
    ];
  }
  edges(): EdgeDescriptor[] {
    const [hx, hy, hz] = this.half;
    return [
      { name: 'top.front',    faces: ['top', 'front'],    kind: 'line', midpoint: [0, hy, hz] },
      { name: 'top.back',     faces: ['top', 'back'],     kind: 'line', midpoint: [0, hy, -hz] },
      { name: 'top.right',    faces: ['top', 'right'],    kind: 'line', midpoint: [hx, hy, 0] },
      { name: 'top.left',     faces: ['top', 'left'],     kind: 'line', midpoint: [-hx, hy, 0] },
      { name: 'bottom.front', faces: ['bottom', 'front'], kind: 'line', midpoint: [0, -hy, hz] },
      { name: 'bottom.back',  faces: ['bottom', 'back'],  kind: 'line', midpoint: [0, -hy, -hz] },
      { name: 'bottom.right', faces: ['bottom', 'right'], kind: 'line', midpoint: [hx, -hy, 0] },
      { name: 'bottom.left',  faces: ['bottom', 'left'],  kind: 'line', midpoint: [-hx, -hy, 0] },
      { name: 'front.right',  faces: ['front', 'right'],  kind: 'line', midpoint: [hx, 0, hz] },
      { name: 'front.left',   faces: ['front', 'left'],   kind: 'line', midpoint: [-hx, 0, hz] },
      { name: 'back.right',   faces: ['back', 'right'],   kind: 'line', midpoint: [hx, 0, -hz] },
      { name: 'back.left',    faces: ['back', 'left'],    kind: 'line', midpoint: [-hx, 0, -hz] },
    ];
  }
  classifyPoint(p: Vec3): string | null {
    const dx = Math.abs(Math.abs(p[0]) - this.half[0]);
    const dy = Math.abs(Math.abs(p[1]) - this.half[1]);
    const dz = Math.abs(Math.abs(p[2]) - this.half[2]);
    if (dx <= dy && dx <= dz) return p[0] >= 0 ? 'right' : 'left';
    if (dy <= dx && dy <= dz) return p[1] >= 0 ? 'top' : 'bottom';
    return p[2] >= 0 ? 'front' : 'back';
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
  faces(): FaceDescriptor[] {
    const hh = this.height / 2;
    return [
      { name: 'top_cap',    normal: [0, 0, 1],  kind: 'planar', origin: [0, 0, hh] },
      { name: 'bottom_cap', normal: [0, 0, -1], kind: 'planar', origin: [0, 0, -hh] },
      { name: 'barrel',     normal: [1, 0, 0],  kind: 'cylindrical', radius: this.radius, axis: [0, 0, 1] },
    ];
  }
  edges(): EdgeDescriptor[] {
    const hh = this.height / 2;
    return [
      { name: 'top_cap.barrel',    faces: ['top_cap', 'barrel'],    kind: 'arc', midpoint: [this.radius, 0, hh] },
      { name: 'bottom_cap.barrel', faces: ['bottom_cap', 'barrel'], kind: 'arc', midpoint: [this.radius, 0, -hh] },
    ];
  }
  classifyPoint(p: Vec3): string | null {
    const hh = this.height / 2;
    const dCap = Math.abs(Math.abs(p[2]) - hh);
    const dBarrel = Math.abs(len2d(p[0], p[1]) - this.radius);
    if (dCap < dBarrel) return p[2] >= 0 ? 'top_cap' : 'bottom_cap';
    return 'barrel';
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
  faces(): FaceDescriptor[] {
    return [
      { name: 'base_cap', normal: [0, 0, -1], kind: 'planar', origin: [0, 0, -this.height] },
      { name: 'surface',  normal: [1, 0, 0],  kind: 'conical', radius: this.radius, axis: [0, 0, 1] },
    ];
  }
  edges(): EdgeDescriptor[] {
    return [
      { name: 'base_cap.surface', faces: ['base_cap', 'surface'], kind: 'arc', midpoint: [this.radius, 0, -this.height] },
    ];
  }
  classifyPoint(p: Vec3): string | null {
    const dBase = Math.abs(p[2] + this.height);
    const r = len2d(p[0], p[1]);
    const expectedR = this.radius * Math.max(0, -p[2] / this.height);
    const dSlant = Math.abs(r - expectedR);
    return dBase < dSlant ? 'base_cap' : 'surface';
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
  faces(): FaceDescriptor[] {
    return [{ name: 'surface', normal: [1, 0, 0], kind: 'toroidal', radius: this.minorRadius }];
  }
  classifyPoint(_p: Vec3): string | null { return 'surface'; }
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
  faces(): FaceDescriptor[] {
    return [{ name: 'surface', normal: this.n, kind: 'planar' }];
  }
  classifyPoint(_p: Vec3): string | null { return 'surface'; }
}

// ─── Boolean operations ────────────────────────────────────────

/** Check if two SDF nodes have face name collisions. Used by mergeFaces() and mergeEdges(). */
function hasFaceNameCollision(a: SDF, b: SDF): boolean {
  const aNames = new Set(a.faces().map(f => f.name));
  return b.faces().some(f => aNames.has(f.name));
}

/** Merge faces from two children, prefixing with a./b. on name collision. */
function mergeFaces(a: SDF, b: SDF): FaceDescriptor[] {
  const aFaces = a.faces();
  const bFaces = b.faces();
  if (hasFaceNameCollision(a, b)) {
    return [
      ...aFaces.map(f => ({ ...f, name: `a.${f.name}` })),
      ...bFaces.map(f => ({ ...f, name: `b.${f.name}` })),
    ];
  }
  return [...aFaces, ...bFaces];
}

/** Merge edges from two children, prefixing with a./b. on face name collision.
 *  Uses face-level collision detection (same trigger as mergeFaces) because
 *  edge names and face references derive from face names. */
function mergeEdges(a: SDF, b: SDF): EdgeDescriptor[] {
  const aEdges = a.edges();
  const bEdges = b.edges();
  if (hasFaceNameCollision(a, b)) {
    return [
      ...aEdges.map(e => ({
        ...e,
        name: `a.${e.name}`,
        faces: [`a.${e.faces[0]}`, `a.${e.faces[1]}`] as [string, string],
      })),
      ...bEdges.map(e => ({
        ...e,
        name: `b.${e.name}`,
        faces: [`b.${e.faces[0]}`, `b.${e.faces[1]}`] as [string, string],
      })),
    ];
  }
  return [...aEdges, ...bEdges];
}

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
  faces(): FaceDescriptor[] { return mergeFaces(this.a, this.b); }
  edges(): EdgeDescriptor[] { return mergeEdges(this.a, this.b); }
  classifyPoint(p: Vec3): string | null {
    const dA = this.a.evaluate(p);
    const dB = this.b.evaluate(p);
    if (Math.abs(dA) < Math.abs(dB)) return this.a.classifyPoint(p);
    return this.b.classifyPoint(p);
  }
  children(): SDF[] { return [this.a, this.b]; }
}

export class Subtract extends SDF {
  readonly kind = 'subtract' as const;
  readonly resolvedFeatureName: string;
  private static nextId = 1;
  /** Reset auto-increment counter (for testing). */
  static resetIdCounter(): void { Subtract.nextId = 1; }
  constructor(readonly a: SDF, readonly b: SDF, readonly featureName?: string) {
    super();
    this.resolvedFeatureName = featureName ?? `subtract_${Subtract.nextId++}`;
  }
  get name() { return `subtract(${this.a.name}, ${this.b.name})`; }
  evaluate(p: Vec3): number {
    return Math.max(this.a.evaluate(p), -this.b.evaluate(p));
  }
  bounds(): BoundingBox {
    return this.a.bounds(); // Conservative: result fits within A
  }
  faces(): FaceDescriptor[] {
    const aFaces = this.a.faces();
    const bFaces = this.b.faces().map(f => ({
      ...f,
      name: `${this.resolvedFeatureName}.${f.name}`,
      normal: [-f.normal[0], -f.normal[1], -f.normal[2]] as Vec3,
    }));
    return [...aFaces, ...bFaces];
  }
  edges(): EdgeDescriptor[] {
    const aEdges = this.a.edges();
    const bEdges = this.b.edges().map(e => ({
      ...e,
      name: `${this.resolvedFeatureName}.${e.name}`,
      faces: [
        `${this.resolvedFeatureName}.${e.faces[0]}`,
        `${this.resolvedFeatureName}.${e.faces[1]}`,
      ] as [string, string],
    }));
    return [...aEdges, ...bEdges];
  }
  classifyPoint(p: Vec3): string | null {
    const dA = this.a.evaluate(p);
    const dB = this.b.evaluate(p);
    if (Math.abs(dB) < Math.abs(dA)) {
      const bFace = this.b.classifyPoint(p);
      return bFace ? `${this.resolvedFeatureName}.${bFace}` : null;
    }
    return this.a.classifyPoint(p);
  }
  children(): SDF[] { return [this.a, this.b]; }
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
  faces(): FaceDescriptor[] { return mergeFaces(this.a, this.b); }
  edges(): EdgeDescriptor[] { return mergeEdges(this.a, this.b); }
  classifyPoint(p: Vec3): string | null {
    const dA = this.a.evaluate(p);
    const dB = this.b.evaluate(p);
    if (Math.abs(dA) > Math.abs(dB)) return this.b.classifyPoint(p);
    return this.a.classifyPoint(p);
  }
  children(): SDF[] { return [this.a, this.b]; }
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
  faces(): FaceDescriptor[] { return mergeFaces(this.a, this.b); }
  edges(): EdgeDescriptor[] { return mergeEdges(this.a, this.b); }
  classifyPoint(p: Vec3): string | null {
    const dA = this.a.evaluate(p);
    const dB = this.b.evaluate(p);
    if (Math.abs(dA) < Math.abs(dB)) return this.a.classifyPoint(p);
    return this.b.classifyPoint(p);
  }
  children(): SDF[] { return [this.a, this.b]; }
}

export class SmoothSubtract extends SDF {
  readonly kind = 'smoothSubtract' as const;
  readonly resolvedFeatureName: string;
  private static nextId = 1;
  /** Reset auto-increment counter (for testing). */
  static resetIdCounter(): void { SmoothSubtract.nextId = 1; }
  constructor(readonly a: SDF, readonly b: SDF, readonly k: number, readonly featureName?: string) {
    super();
    this.resolvedFeatureName = featureName ?? `smooth_subtract_${SmoothSubtract.nextId++}`;
  }
  get name() { return `smoothSubtract(${this.a.name}, ${this.b.name}, k=${this.k})`; }
  evaluate(p: Vec3): number {
    return smax(this.a.evaluate(p), -this.b.evaluate(p), this.k);
  }
  bounds(): BoundingBox {
    return this.a.bounds();
  }
  faces(): FaceDescriptor[] {
    const aFaces = this.a.faces();
    const bFaces = this.b.faces().map(f => ({
      ...f,
      name: `${this.resolvedFeatureName}.${f.name}`,
      normal: [-f.normal[0], -f.normal[1], -f.normal[2]] as Vec3,
    }));
    return [...aFaces, ...bFaces];
  }
  edges(): EdgeDescriptor[] {
    const aEdges = this.a.edges();
    const bEdges = this.b.edges().map(e => ({
      ...e,
      name: `${this.resolvedFeatureName}.${e.name}`,
      faces: [
        `${this.resolvedFeatureName}.${e.faces[0]}`,
        `${this.resolvedFeatureName}.${e.faces[1]}`,
      ] as [string, string],
    }));
    return [...aEdges, ...bEdges];
  }
  classifyPoint(p: Vec3): string | null {
    const dA = this.a.evaluate(p);
    const dB = this.b.evaluate(p);
    if (Math.abs(dB) < Math.abs(dA)) {
      const bFace = this.b.classifyPoint(p);
      return bFace ? `${this.resolvedFeatureName}.${bFace}` : null;
    }
    return this.a.classifyPoint(p);
  }
  children(): SDF[] { return [this.a, this.b]; }
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
  faces(): FaceDescriptor[] { return mergeFaces(this.a, this.b); }
  edges(): EdgeDescriptor[] { return mergeEdges(this.a, this.b); }
  classifyPoint(p: Vec3): string | null {
    const dA = this.a.evaluate(p);
    const dB = this.b.evaluate(p);
    if (Math.abs(dA) > Math.abs(dB)) return this.b.classifyPoint(p);
    return this.a.classifyPoint(p);
  }
  children(): SDF[] { return [this.a, this.b]; }
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
  faces(): FaceDescriptor[] {
    return this.child.faces().map(f => ({
      ...f,
      origin: f.origin ? add(f.origin, this.offset) : undefined,
    }));
  }
  edges(): EdgeDescriptor[] {
    return this.child.edges().map(e => ({
      ...e,
      midpoint: e.midpoint ? add(e.midpoint, this.offset) : undefined,
    }));
  }
  classifyPoint(p: Vec3): string | null {
    return this.child.classifyPoint(sub(p, this.offset));
  }
  children(): SDF[] { return [this.child]; }
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
  /** Rotate point by the forward rotation (child-space → parent-space). */
  protected rotateForward(p: Vec3): Vec3 {
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
  /** Rotate the inverse direction (parent-space → child-space). */
  private rotateInverse(p: Vec3): Vec3 {
    const { c, s } = this;
    switch (this.axis) {
      case 'x': return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
      case 'y': return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
      case 'z': return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
    }
  }
  faces(): FaceDescriptor[] {
    return this.child.faces().map(f => ({
      ...f,
      normal: this.rotateForward(f.normal),
      origin: f.origin ? this.rotateForward(f.origin) : undefined,
      axis: f.axis ? this.rotateForward(f.axis) : undefined,
    }));
  }
  edges(): EdgeDescriptor[] {
    return this.child.edges().map(e => ({
      ...e,
      midpoint: e.midpoint ? this.rotateForward(e.midpoint) : undefined,
    }));
  }
  classifyPoint(p: Vec3): string | null {
    return this.child.classifyPoint(this.rotateInverse(p));
  }
  children(): SDF[] { return [this.child]; }
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
  faces(): FaceDescriptor[] {
    return this.child.faces().map(f => ({
      ...f,
      origin: f.origin ? scale(f.origin, this.factor) : undefined,
      radius: f.radius !== undefined ? f.radius * this.factor : undefined,
    }));
  }
  edges(): EdgeDescriptor[] {
    return this.child.edges().map(e => ({
      ...e,
      midpoint: e.midpoint ? scale(e.midpoint, this.factor) : undefined,
    }));
  }
  classifyPoint(p: Vec3): string | null {
    return this.child.classifyPoint(scale(p, 1 / this.factor));
  }
  children(): SDF[] { return [this.child]; }
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
  faces(): FaceDescriptor[] { return this.child.faces(); }
  edges(): EdgeDescriptor[] { return this.child.edges(); }
  classifyPoint(p: Vec3): string | null {
    const i = this.axis === 'x' ? 0 : this.axis === 'y' ? 1 : 2;
    const mp: Vec3 = [...p];
    mp[i] = Math.abs(mp[i]);
    return this.child.classifyPoint(mp);
  }
  children(): SDF[] { return [this.child]; }
}

// ─── Modifiers ─────────────────────────────────────────────────

export class Shell extends SDF {
  readonly kind = 'shell' as const;
  constructor(readonly child: SDF, readonly thickness: number) { super(); }
  get name() { return `${this.child.name}.shell(${this.thickness})`; }
  evaluate(p: Vec3): number {
    return Math.abs(this.child.evaluate(p)) - this.thickness / 2;
  }
  faces(): FaceDescriptor[] {
    const childFaces = this.child.faces();
    return [
      ...childFaces.map(f => ({ ...f, name: `outer_${f.name}` })),
      ...childFaces.map(f => ({
        ...f,
        name: `inner_${f.name}`,
        normal: [-f.normal[0], -f.normal[1], -f.normal[2]] as Vec3,
      })),
    ];
  }
  edges(): EdgeDescriptor[] {
    const childEdges = this.child.edges();
    return [
      ...childEdges.map(e => ({
        ...e,
        name: `outer_${e.name}`,
        faces: [`outer_${e.faces[0]}`, `outer_${e.faces[1]}`] as [string, string],
      })),
      ...childEdges.map(e => ({
        ...e,
        name: `inner_${e.name}`,
        faces: [`inner_${e.faces[0]}`, `inner_${e.faces[1]}`] as [string, string],
      })),
    ];
  }
  classifyPoint(p: Vec3): string | null {
    const d = this.child.evaluate(p);
    const face = this.child.classifyPoint(p);
    if (!face) return null;
    return d >= 0 ? `outer_${face}` : `inner_${face}`;
  }
  children(): SDF[] { return [this.child]; }
}

export class Round extends SDF {
  readonly kind = 'round' as const;
  constructor(readonly child: SDF, readonly radius: number) { super(); }
  get name() { return `${this.child.name}.round(${this.radius})`; }
  evaluate(p: Vec3): number {
    return this.child.evaluate(p) - this.radius;
  }
  faces(): FaceDescriptor[] { return this.child.faces(); }
  edges(): EdgeDescriptor[] { return this.child.edges(); }
  classifyPoint(p: Vec3): string | null { return this.child.classifyPoint(p); }
  children(): SDF[] { return [this.child]; }
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
  faces(): FaceDescriptor[] { return this.child.faces(); }
  edges(): EdgeDescriptor[] { return this.child.edges(); }
  classifyPoint(p: Vec3): string | null {
    const q: Vec3 = [
      p[0] - Math.max(-this.half[0], Math.min(p[0], this.half[0])),
      p[1] - Math.max(-this.half[1], Math.min(p[1], this.half[1])),
      p[2] - Math.max(-this.half[2], Math.min(p[2], this.half[2])),
    ];
    return this.child.classifyPoint(q);
  }
  children(): SDF[] { return [this.child]; }
}

export class EdgeBreak extends SDF {
  readonly kind = 'edge_break' as const;

  constructor(
    readonly child: SDF,
    readonly faceA: { normal: Vec3; origin: Vec3 },
    readonly faceB: { normal: Vec3; origin: Vec3 },
    readonly size: number,
    readonly mode: 'chamfer' | 'fillet',
    readonly featureName: string,
    readonly removedEdgeName: string,
  ) {
    super();
  }

  get name() {
    return `${this.child.name}.${this.mode}(${this.removedEdgeName}, ${this.size})`;
  }

  evaluate(p: Vec3): number {
    const dA = dot(sub(p, this.faceA.origin), this.faceA.normal);
    const dB = dot(sub(p, this.faceB.origin), this.faceB.normal);
    const childVal = this.child.evaluate(p);

    if (this.mode === 'chamfer') {
      const cut = (dA + dB + this.size) / Math.SQRT2;
      return Math.max(childVal, cut);
    }

    // Fillet: circular blend centered at edge
    const r = this.size;
    const inA = Math.max(0, Math.min(-dA, r));
    const inB = Math.max(0, Math.min(-dB, r));
    const cut = r - Math.sqrt(inA * inA + inB * inB);
    return Math.max(childVal, cut);
  }

  bounds(): BoundingBox {
    return this.child.bounds(); // Conservative: break only removes material
  }

  faces(): FaceDescriptor[] {
    const childFaces = this.child.faces();
    return [
      ...childFaces,
      {
        name: `${this.featureName}.face`,
        normal: normalize(add(this.faceA.normal, this.faceB.normal)),
        kind: 'freeform' as const,
      },
    ];
  }

  edges(): EdgeDescriptor[] {
    return this.child.edges().filter(e => e.name !== this.removedEdgeName);
  }

  classifyPoint(p: Vec3): string | null {
    const dA = dot(sub(p, this.faceA.origin), this.faceA.normal);
    const dB = dot(sub(p, this.faceB.origin), this.faceB.normal);

    // In the edge-break region: both faces are nearby and inside
    const r = this.size;
    if (dA < 0 && dB < 0 && -dA < r && -dB < r) {
      // Check if the break cut is the dominant surface here
      const inA = Math.min(-dA, r);
      const inB = Math.min(-dB, r);
      const cut = this.mode === 'chamfer'
        ? (dA + dB + r) / Math.SQRT2
        : r - Math.sqrt(inA * inA + inB * inB);
      const childVal = this.child.evaluate(p);
      if (cut > childVal - 0.01) {
        return `${this.featureName}.face`;
      }
    }

    return this.child.classifyPoint(p);
  }

  children(): SDF[] { return [this.child]; }
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

  faces(): FaceDescriptor[] {
    const result: FaceDescriptor[] = [
      { name: 'top', normal: [0, 0, 1], kind: 'planar', origin: [0, 0, this.halfH] },
      { name: 'bottom', normal: [0, 0, -1], kind: 'planar', origin: [0, 0, -this.halfH] },
    ];
    if (this.profile instanceof Circle2D) {
      result.push({
        name: 'wall', normal: [1, 0, 0], kind: 'cylindrical',
        radius: this.profile.radius, axis: [0, 0, 1],
      });
    } else if (this.profile instanceof Rect2D) {
      result.push(
        { name: 'wall_right', normal: [1, 0, 0], kind: 'planar', origin: [this.profile.halfW, 0, 0] },
        { name: 'wall_left', normal: [-1, 0, 0], kind: 'planar', origin: [-this.profile.halfW, 0, 0] },
        { name: 'wall_front', normal: [0, 1, 0], kind: 'planar', origin: [0, this.profile.halfH, 0] },
        { name: 'wall_back', normal: [0, -1, 0], kind: 'planar', origin: [0, -this.profile.halfH, 0] },
      );
    } else {
      result.push({ name: 'wall', normal: [1, 0, 0], kind: 'freeform' });
    }
    return result;
  }

  classifyPoint(p: Vec3): string | null {
    const d2d = this.profile.evaluate(p[0], p[1]);
    const dCap = Math.abs(p[2]) - this.halfH;
    if (Math.abs(dCap) < Math.abs(d2d)) {
      return p[2] >= 0 ? 'top' : 'bottom';
    }
    if (this.profile instanceof Rect2D) {
      const dx = Math.abs(Math.abs(p[0]) - this.profile.halfW);
      const dy = Math.abs(Math.abs(p[1]) - this.profile.halfH);
      if (dx < dy) {
        return p[0] >= 0 ? 'wall_right' : 'wall_left';
      }
      return p[1] >= 0 ? 'wall_front' : 'wall_back';
    }
    return 'wall';
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

  faces(): FaceDescriptor[] {
    if (this.profile instanceof Rect2D) {
      const outerR = this.offset + this.profile.halfW;
      const innerR = this.offset - this.profile.halfW;
      const result: FaceDescriptor[] = [
        { name: 'top', normal: [0, 0, 1], kind: 'planar', origin: [0, 0, this.profile.halfH] },
        { name: 'bottom', normal: [0, 0, -1], kind: 'planar', origin: [0, 0, -this.profile.halfH] },
        { name: 'outer_wall', normal: [1, 0, 0], kind: 'cylindrical', radius: outerR, axis: [0, 0, 1] },
      ];
      if (innerR > 0) {
        result.push({
          name: 'inner_wall', normal: [-1, 0, 0], kind: 'cylindrical',
          radius: innerR, axis: [0, 0, 1],
        });
      }
      return result;
    }
    if (this.profile instanceof Circle2D) {
      return [{ name: 'surface', normal: [1, 0, 0], kind: 'toroidal', radius: this.profile.radius }];
    }
    return [{ name: 'surface', normal: [1, 0, 0], kind: 'freeform' }];
  }

  classifyPoint(p: Vec3): string | null {
    const r = len2d(p[0], p[1]);
    if (this.profile instanceof Rect2D) {
      const localR = r - this.offset;
      const dRadial = Math.abs(localR) - this.profile.halfW;
      const dAxial = Math.abs(p[2]) - this.profile.halfH;
      if (Math.abs(dAxial) < Math.abs(dRadial)) {
        return p[2] >= 0 ? 'top' : 'bottom';
      }
      const innerR = this.offset - this.profile.halfW;
      return localR >= 0 ? 'outer_wall' : (innerR > 0 ? 'inner_wall' : 'outer_wall');
    }
    return 'surface';
  }
}
