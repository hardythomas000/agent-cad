// Public API
export { SDF } from './sdf.js';
export type { SDFReadback } from './sdf.js';
export type { Vec3, BoundingBox } from './vec3.js';
export { vec3 } from './vec3.js';

// Primitives
export { box, sphere, cylinder, cone, torus, plane } from './api.js';

// Standalone booleans
export { union, subtract, intersect } from './api.js';

// Mesh export
export type { TriangleMesh } from './mesh.js';
export { marchingCubes } from './marching-cubes.js';
export { exportSTL } from './stl.js';

// Node classes (for advanced use / type checking)
export {
  Sphere, Box, Cylinder, Cone, Torus, Plane,
  Union, Subtract, Intersect,
  SmoothUnion, SmoothSubtract, SmoothIntersect,
  Translate, RotateAxis, Scale, Mirror,
  Shell, Round, Elongate,
} from './sdf.js';
