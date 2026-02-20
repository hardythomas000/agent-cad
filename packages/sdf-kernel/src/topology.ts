/**
 * Named Topology — face and edge identity for SDF shapes.
 *
 * SDFs are implicit surfaces with no explicit faces/edges.
 * This module adds analytical face identity: each primitive knows
 * its faces from its math, and faces propagate through transforms
 * and booleans with stable semantic names.
 *
 *   box(100, 60, 30).face("top")  →  { normal: [0,1,0], kind: "planar", origin: [0,30,0] }
 *   subtract(box, cyl, "hole_1").face("hole_1.barrel")  →  { kind: "cylindrical", radius: 5 }
 */

import type { Vec3 } from './vec3.js';

// ─── Face types ──────────────────────────────────────────────

export type FaceKind = 'planar' | 'cylindrical' | 'conical' | 'spherical' | 'toroidal' | 'freeform';

export interface FaceDescriptor {
  /** Semantic name: "top", "barrel", "hole_1.wall" */
  name: string;
  /** Representative outward normal (varies across non-planar faces) */
  normal: Vec3;
  /** Surface geometry type */
  kind: FaceKind;
  /** For planar: a point on the face */
  origin?: Vec3;
  /** For cylindrical/spherical/conical: radius in mm */
  radius?: number;
  /** For cylindrical/conical: axis direction */
  axis?: Vec3;
  /** For edge break faces: chamfer size or fillet radius in mm */
  edgeBreakSize?: number;
  /** For edge break faces: 'chamfer' or 'fillet' */
  edgeBreakMode?: 'chamfer' | 'fillet';
}

// ─── Edge types ──────────────────────────────────────────────

export type EdgeKind = 'line' | 'arc' | 'curve';

export interface EdgeDescriptor {
  /** Semantic name: "top.front" (intersection of two faces) */
  name: string;
  /** The two face names that form this edge */
  faces: [string, string];
  /** Edge geometry type */
  kind: EdgeKind;
  /** Approximate midpoint of the edge */
  midpoint?: Vec3;
}
