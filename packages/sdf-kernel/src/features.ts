/**
 * Semantic Feature Constructors — intent-based geometry operations.
 *
 *   hole(shape, "top", { diameter: 10, depth: "through" })
 *
 * Resolves face topology to auto-orient and position features.
 * The LLM declares intent; the kernel resolves geometry.
 */

import { SDF, Box, Cylinder, EdgeBreak } from './sdf.js';
import type { Vec3 } from './vec3.js';
import type { EdgeDescriptor, FaceDescriptor } from './topology.js';

// ─── Types ──────────────────────────────────────────────────────

export interface HoleOptions {
  /** Hole diameter in mm. */
  diameter: number;
  /** Depth in mm, or "through" for full penetration. */
  depth: number | 'through';
  /** 3D offset from face center. Normal component is dropped (projected onto face plane). */
  at?: Vec3;
  /** Feature name for topology. Default: auto "hole_N" derived from shape. */
  featureName?: string;
}

// ─── Narrowed face type ──────────────────────────────────────────

interface PlanarFace {
  name: string;
  normal: Vec3;
  kind: 'planar';
  origin: Vec3;
}

// ─── hole() ─────────────────────────────────────────────────────

/**
 * Create a hole on a named planar face.
 * Returns a new SDF with the hole subtracted.
 *
 * Only axis-aligned faces are supported in v1.
 */
export function hole(shape: SDF, faceName: string, opts: HoleOptions): SDF {
  const face = resolvePlanarFace(shape, faceName, 'hole');

  if (opts.diameter <= 0) {
    throw new Error(`hole() diameter must be positive, got ${opts.diameter}`);
  }
  if (typeof opts.depth === 'number' && opts.depth <= 0) {
    throw new Error(`hole() depth must be positive, got ${opts.depth}`);
  }

  const depth = resolveDepth(shape, face, opts.depth);
  const cyl = new Cylinder(opts.diameter / 2, depth);
  let positioned = positionOnFace(cyl, face, depth, 'hole');

  if (opts.at) {
    positioned = applyFaceOffset(positioned, face, opts.at);
  }

  const featureName = opts.featureName ?? nextFeatureName(shape, 'hole');
  return shape.subtract(positioned, featureName);
}

// ─── pocket() ───────────────────────────────────────────────────

export interface PocketOptions {
  /** Pocket width (along face U axis) in mm. */
  width: number;
  /** Pocket length (along face V axis) in mm. */
  length: number;
  /** Pocket depth in mm. */
  depth: number;
  /** 3D offset from face center. Normal component is dropped. */
  at?: Vec3;
  /** Feature name for topology. Default: auto "pocket_N". */
  featureName?: string;
}

/**
 * Cut a rectangular pocket on a named planar face.
 * Returns a new SDF with the pocket subtracted.
 */
export function pocket(shape: SDF, faceName: string, opts: PocketOptions): SDF {
  const face = resolvePlanarFace(shape, faceName, 'pocket');

  if (opts.width <= 0) {
    throw new Error(`pocket() width must be positive, got ${opts.width}`);
  }
  if (opts.length <= 0) {
    throw new Error(`pocket() length must be positive, got ${opts.length}`);
  }
  if (typeof opts.depth !== 'number' || opts.depth <= 0) {
    throw new Error(`pocket() depth must be a positive number, got ${opts.depth}. For through-cuts, use subtract() directly.`);
  }

  const b = new Box(opts.width, opts.length, opts.depth);
  let positioned = positionOnFace(b, face, opts.depth, 'pocket');

  if (opts.at) {
    positioned = applyFaceOffset(positioned, face, opts.at);
  }

  const featureName = opts.featureName ?? nextFeatureName(shape, 'pocket');
  return shape.subtract(positioned, featureName);
}

// ─── boltCircle() ───────────────────────────────────────────────

export interface BoltCircleOptions {
  /** Number of holes. */
  count: number;
  /** Bolt circle diameter (center-to-center) in mm. */
  boltCircleDiameter: number;
  /** Individual hole diameter in mm. */
  holeDiameter: number;
  /** Hole depth in mm, or "through". */
  depth: number | 'through';
  /** Start angle in degrees (default 0 = first hole on U axis). */
  startAngle?: number;
  /** 3D offset for bolt circle center. Normal component is dropped. */
  at?: Vec3;
  /** Feature name prefix for individual holes. Default: auto-incremented "hole_N" (delegated to hole()). */
  featureName?: string;
}

/**
 * Create N holes arranged on a circular pattern on a planar face.
 * Composes hole() for each position.
 */
export function boltCircle(shape: SDF, faceName: string, opts: BoltCircleOptions): SDF {
  const face = resolvePlanarFace(shape, faceName, 'boltCircle');

  if (opts.count < 1) {
    throw new Error(`boltCircle() count must be >= 1, got ${opts.count}`);
  }
  if (opts.boltCircleDiameter <= 0) {
    throw new Error(`boltCircle() boltCircleDiameter must be positive, got ${opts.boltCircleDiameter}`);
  }

  // Pre-resolve depth once (extent along face normal is constant across all holes)
  const resolvedDepth = opts.depth === 'through'
    ? resolveDepth(shape, face, 'through')
    : opts.depth;

  const [u, v] = faceAxes(face.normal);
  const bcr = opts.boltCircleDiameter / 2;
  const startRad = ((opts.startAngle ?? 0) * Math.PI) / 180;
  const baseOffset = opts.at ?? [0, 0, 0];

  let result = shape;
  for (let i = 0; i < opts.count; i++) {
    const angle = startRad + (2 * Math.PI * i) / opts.count;
    const du = Math.cos(angle) * bcr;
    const dv = Math.sin(angle) * bcr;
    const at: Vec3 = [
      baseOffset[0] + u[0] * du + v[0] * dv,
      baseOffset[1] + u[1] * du + v[1] * dv,
      baseOffset[2] + u[2] * du + v[2] * dv,
    ];
    result = hole(result, faceName, {
      diameter: opts.holeDiameter,
      depth: resolvedDepth,
      at,
      featureName: opts.featureName ? `${opts.featureName}_${i + 1}` : undefined,
    });
  }

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Resolve a face name to a guaranteed planar face, or throw with helpful error. */
function resolvePlanarFace(shape: SDF, faceName: string, callerName: string): PlanarFace {
  const face = shape.face(faceName);
  if (face.kind !== 'planar') {
    const planarFaces = shape.faces().filter(f => f.kind === 'planar').map(f => f.name);
    throw new Error(
      `${callerName}() requires a planar face, but "${faceName}" is ${face.kind}. ` +
      `Available planar faces: [${planarFaces.join(', ')}]`
    );
  }
  if (!face.origin) {
    throw new Error(
      `${callerName}() requires face "${faceName}" to have an origin, but it is undefined. ` +
      `This is likely a kernel bug — planar faces should always report an origin.`
    );
  }
  return { name: face.name, normal: face.normal, kind: 'planar', origin: face.origin };
}

/** Resolve depth: 'through' calculates from bounds, number passes through. */
function resolveDepth(shape: SDF, face: PlanarFace, depth: number | 'through'): number {
  if (depth === 'through') {
    const bounds = shape.bounds();
    const n = face.normal;
    const extent = Math.abs(
      (bounds.max[0] - bounds.min[0]) * n[0] +
      (bounds.max[1] - bounds.min[1]) * n[1] +
      (bounds.max[2] - bounds.min[2]) * n[2]
    );
    return extent + 1; // 1mm clearance
  }
  return depth;
}

/** Orient a shape from Z-axis to face inward normal, then translate to face origin. */
function positionOnFace(tool: SDF, face: PlanarFace, depth: number, callerName: string): SDF {
  const inward: Vec3 = [-face.normal[0], -face.normal[1], -face.normal[2]];
  const oriented = orientToAxis(tool, inward, callerName);
  return oriented.translate(
    face.origin[0] + inward[0] * (depth / 2),
    face.origin[1] + inward[1] * (depth / 2),
    face.origin[2] + inward[2] * (depth / 2),
  );
}

/** Apply a 3D offset projected onto the face plane (normal component dropped). */
function applyFaceOffset(shape: SDF, face: PlanarFace, at: Vec3): SDF {
  const n = face.normal;
  const dot = at[0] * n[0] + at[1] * n[1] + at[2] * n[2];
  return shape.translate(
    at[0] - dot * n[0],
    at[1] - dot * n[1],
    at[2] - dot * n[2],
  );
}

/** Count existing prefix_N features to derive next name. */
function nextFeatureName(shape: SDF, prefix: string): string {
  const re = new RegExp(`^${prefix}_(\\d+)\\.`);
  const nums = new Set<number>();
  for (const f of shape.faces()) {
    const m = f.name.match(re);
    if (m) nums.add(Number(m[1]));
  }
  return `${prefix}_${Math.max(...nums, 0) + 1}`;
}

/**
 * Orient an SDF from Z-axis to a cardinal direction.
 * 6-case lookup — throws on non-axis-aligned normals.
 */
function orientToAxis(shape: SDF, normal: Vec3, callerName: string): SDF {
  const [nx, ny, nz] = normal;
  if (Math.abs(nz - 1) < 1e-9) return shape;               // +Z (no rotation)
  if (Math.abs(nz + 1) < 1e-9) return shape.rotateX(180);   // -Z
  if (Math.abs(ny - 1) < 1e-9) return shape.rotateX(-90);   // +Y
  if (Math.abs(ny + 1) < 1e-9) return shape.rotateX(90);    // -Y
  if (Math.abs(nx - 1) < 1e-9) return shape.rotateY(90);    // +X
  if (Math.abs(nx + 1) < 1e-9) return shape.rotateY(-90);   // -X
  throw new Error(
    `${callerName}() only supports axis-aligned faces in v1. ` +
    `Normal [${nx}, ${ny}, ${nz}] is not axis-aligned.`
  );
}

// ─── chamfer() ──────────────────────────────────────────────────

/**
 * Create a chamfer (flat bevel) on a named edge.
 * Returns a new SDF with the edge chamfered.
 *
 * Only axis-aligned planar-planar edges in v1.
 */
export function chamfer(shape: SDF, edgeName: string, size: number, featureName?: string): SDF {
  if (size <= 0) {
    throw new Error(`chamfer() size must be positive, got ${size}`);
  }
  const { faceA, faceB } = resolveEdge(shape, edgeName, 'chamfer');
  const name = featureName ?? nextFeatureName(shape, 'chamfer');
  return new EdgeBreak(
    shape,
    { normal: faceA.normal, origin: faceA.origin! },
    { normal: faceB.normal, origin: faceB.origin! },
    size, 'chamfer', name, edgeName,
  );
}

// ─── fillet() ───────────────────────────────────────────────────

/**
 * Create a fillet (circular blend) on a named edge.
 * Returns a new SDF with the edge filleted.
 *
 * Only axis-aligned planar-planar edges in v1.
 */
export function fillet(shape: SDF, edgeName: string, radius: number, featureName?: string): SDF {
  if (radius <= 0) {
    throw new Error(`fillet() radius must be positive, got ${radius}`);
  }
  const { faceA, faceB } = resolveEdge(shape, edgeName, 'fillet');
  const name = featureName ?? nextFeatureName(shape, 'fillet');
  return new EdgeBreak(
    shape,
    { normal: faceA.normal, origin: faceA.origin! },
    { normal: faceB.normal, origin: faceB.origin! },
    radius, 'fillet', name, edgeName,
  );
}

// ─── resolveEdge() (private) ────────────────────────────────────

/** Resolve an edge name to its two planar face descriptors, or throw with helpful error. */
function resolveEdge(
  shape: SDF,
  edgeName: string,
  callerName: string,
): { edge: EdgeDescriptor; faceA: FaceDescriptor; faceB: FaceDescriptor } {
  const allEdges = shape.edges();
  const edge = allEdges.find(e => e.name === edgeName);
  if (!edge) {
    throw new Error(
      `${callerName}() edge "${edgeName}" not found. ` +
      `Available edges: [${allEdges.map(e => e.name).join(', ')}]`
    );
  }

  const faceA = shape.faces().find(f => f.name === edge.faces[0]);
  const faceB = shape.faces().find(f => f.name === edge.faces[1]);
  if (!faceA || !faceB) {
    throw new Error(
      `${callerName}() could not resolve faces for edge "${edgeName}". ` +
      `Expected faces "${edge.faces[0]}" and "${edge.faces[1]}".`
    );
  }

  if (faceA.kind !== 'planar' || faceB.kind !== 'planar') {
    const planarEdges = allEdges.filter(e => {
      const fa = shape.faces().find(f => f.name === e.faces[0]);
      const fb = shape.faces().find(f => f.name === e.faces[1]);
      return fa?.kind === 'planar' && fb?.kind === 'planar';
    });
    throw new Error(
      `${callerName}() requires a planar-planar edge, but "${edgeName}" has ` +
      `${faceA.kind} ("${faceA.name}") and ${faceB.kind} ("${faceB.name}"). ` +
      `Available planar edges: [${planarEdges.map(e => e.name).join(', ')}]`
    );
  }

  if (!faceA.origin || !faceB.origin) {
    throw new Error(
      `${callerName}() requires both faces of edge "${edgeName}" to have origins. ` +
      `This is likely a kernel bug — planar faces should always report an origin.`
    );
  }

  return { edge, faceA, faceB };
}

/**
 * Return U/V axes for a face plane given its outward normal.
 * 6-case lookup for axis-aligned faces.
 */
function faceAxes(normal: Vec3): [Vec3, Vec3] {
  const [nx, ny, nz] = normal;
  if (Math.abs(ny - 1) < 1e-9 || Math.abs(ny + 1) < 1e-9) return [[1, 0, 0], [0, 0, 1]]; // top/bottom → X, Z
  if (Math.abs(nz - 1) < 1e-9 || Math.abs(nz + 1) < 1e-9) return [[1, 0, 0], [0, 1, 0]]; // front/back → X, Y
  if (Math.abs(nx - 1) < 1e-9 || Math.abs(nx + 1) < 1e-9) return [[0, 0, 1], [0, 1, 0]]; // left/right → Z, Y
  throw new Error(`faceAxes() only supports axis-aligned normals in v1. Normal [${nx}, ${ny}, ${nz}] is not axis-aligned.`);
}
