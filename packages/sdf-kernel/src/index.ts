// Public API
export { SDF } from './sdf.js';
export type { SDFReadback } from './sdf.js';
export type { Vec2, Vec3, BoundingBox } from './vec3.js';
export { vec3 } from './vec3.js';

// Named Topology
export type { FaceDescriptor, EdgeDescriptor, FaceKind, EdgeKind } from './topology.js';

// 2D Profile API
export { SDF2D } from './sdf2d.js';
export type { BoundingBox2D } from './sdf2d.js';

// Primitives
export { box, sphere, cylinder, cone, torus, plane } from './api.js';

// 2D Profile constructors
export { polygon, circle2d, rect2d } from './api.js';

// 2D → 3D constructors
export { extrude, revolve } from './api.js';

// Standalone booleans
export { union, subtract, intersect } from './api.js';

// Mesh export
export type { TriangleMesh } from './mesh.js';
export { marchingCubes } from './marching-cubes.js';
export { exportSTL } from './stl.js';

// Toolpath generation
export type { ToolDefinition, ToolpathPoint, ToolpathParams, ToolpathResult, ToolpathStats } from './toolpath.js';
export { generateRasterSurfacing } from './toolpath.js';

// G-code emission
export type { GCodeConfig } from './gcode.js';
export { emitFanucGCode } from './gcode.js';

// Feature constructors (semantic DSL)
export { hole } from './features.js';
export type { HoleOptions } from './features.js';

// Node classes (for advanced use / type checking)
export {
  Sphere, Box, Cylinder, Cone, Torus, Plane,
  Union, Subtract, Intersect,
  SmoothUnion, SmoothSubtract, SmoothIntersect,
  Translate, RotateAxis, Scale, Mirror,
  Shell, Round, Elongate,
  Extrude, Revolve,
} from './sdf.js';
export { Polygon2D, Circle2D, Rect2D } from './sdf2d.js';
