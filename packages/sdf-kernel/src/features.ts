/**
 * Semantic Feature Constructors — intent-based geometry operations.
 *
 *   hole(shape, "top", { diameter: 10, depth: "through" })
 *
 * Resolves face topology to auto-orient and position features.
 * The LLM declares intent; the kernel resolves geometry.
 */

import { SDF, Cylinder } from './sdf.js';
import type { Vec3 } from './vec3.js';

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

// ─── hole() ─────────────────────────────────────────────────────

/**
 * Create a hole on a named planar face.
 * Returns a new SDF with the hole subtracted.
 *
 * Only axis-aligned faces are supported in v1.
 */
export function hole(shape: SDF, faceName: string, opts: HoleOptions): SDF {
  const face = shape.face(faceName);

  if (face.kind !== 'planar') {
    const planarFaces = shape.faces().filter(f => f.kind === 'planar').map(f => f.name);
    throw new Error(
      `hole() requires a planar face, but "${faceName}" is ${face.kind}. ` +
      `Available planar faces: [${planarFaces.join(', ')}]`
    );
  }

  if (typeof opts.depth === 'number' && opts.depth <= 0) {
    throw new Error(`hole() depth must be positive, got ${opts.depth}`);
  }

  // Resolve depth
  let holeDepth: number;
  if (opts.depth === 'through') {
    const bounds = shape.bounds();
    const n = face.normal;
    const extent = Math.abs(
      (bounds.max[0] - bounds.min[0]) * n[0] +
      (bounds.max[1] - bounds.min[1]) * n[1] +
      (bounds.max[2] - bounds.min[2]) * n[2]
    );
    holeDepth = extent + 1; // 1mm clearance
  } else {
    holeDepth = opts.depth;
  }

  // Create cylinder along Z
  const cyl = new Cylinder(opts.diameter / 2, holeDepth);

  // Orient to face inward normal (6-case lookup)
  const inward: Vec3 = [-face.normal[0], -face.normal[1], -face.normal[2]];
  const oriented = orientToAxis(cyl, inward);

  // Position: face origin + inward offset of holeDepth/2 (so cylinder fully penetrates)
  const center = face.origin ?? [0, 0, 0];
  const inwardOffset = holeDepth / 2;
  let positioned = oriented.translate(
    center[0] + inward[0] * inwardOffset,
    center[1] + inward[1] * inwardOffset,
    center[2] + inward[2] * inwardOffset,
  );

  // Apply 3D offset (projected onto face plane by dropping normal component)
  if (opts.at) {
    const n = face.normal;
    const dot = opts.at[0] * n[0] + opts.at[1] * n[1] + opts.at[2] * n[2];
    positioned = positioned.translate(
      opts.at[0] - dot * n[0],
      opts.at[1] - dot * n[1],
      opts.at[2] - dot * n[2],
    );
  }

  // Derive feature name from existing faces
  const featureName = opts.featureName ?? nextFeatureName(shape, 'hole');
  return shape.subtract(positioned, featureName);
}

// ─── Helpers ────────────────────────────────────────────────────

/** Count existing prefix_N features (unique numbers) to derive next name. */
function nextFeatureName(shape: SDF, prefix: string): string {
  const re = new RegExp(`^${prefix}_(\\d+)\\.`);
  const nums = new Set<number>();
  for (const f of shape.faces()) {
    const m = f.name.match(re);
    if (m) nums.add(Number(m[1]));
  }
  return `${prefix}_${nums.size + 1}`;
}

/**
 * Orient an SDF from Z-axis to a cardinal direction.
 * 6-case lookup — throws on non-axis-aligned normals.
 */
function orientToAxis(shape: SDF, normal: Vec3): SDF {
  const [nx, ny, nz] = normal;
  if (Math.abs(nz - 1) < 1e-9) return shape;               // +Z (no rotation)
  if (Math.abs(nz + 1) < 1e-9) return shape.rotateX(180);   // -Z
  if (Math.abs(ny - 1) < 1e-9) return shape.rotateX(-90);   // +Y
  if (Math.abs(ny + 1) < 1e-9) return shape.rotateX(90);    // -Y
  if (Math.abs(nx - 1) < 1e-9) return shape.rotateY(90);    // +X
  if (Math.abs(nx + 1) < 1e-9) return shape.rotateY(-90);   // -X
  throw new Error(
    `hole() only supports axis-aligned faces in v1. ` +
    `Normal [${nx}, ${ny}, ${nz}] is not axis-aligned.`
  );
}
