/**
 * Triangle mesh types — output of marching cubes.
 */

import type { Vec3, BoundingBox } from './vec3.js';

export interface TriangleMesh {
  /** Vertex positions. May contain duplicates (no dedup in v1). */
  vertices: Vec3[];
  /** Triangle indices into vertices[], groups of 3. */
  indices: number[];
  vertexCount: number;
  triangleCount: number;
  bounds: BoundingBox;
}
