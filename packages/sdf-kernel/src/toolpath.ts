/**
 * Toolpath Generation — 3-axis ball nose surface finishing.
 *
 * Generates parallel raster toolpaths directly from SDF geometry
 * via surface finding. No mesh intermediary — the SDF IS the geometry.
 *
 * Coordinate convention:
 *   SDF / Three.js: Y-up  (X right, Y up, Z toward camera)
 *   CNC / G-code:   Z-up  (X right, Y depth, Z up / spindle)
 *
 * Points are stored in SDF convention (Y-up) so the viewer renders
 * them directly. The G-code emitter swaps Y↔Z on output.
 *
 * Internally: raster grid in SDF XZ, drop along SDF -Y (downward).
 * User-facing params (safe_z, z_top, z_bottom) are CNC Z-up convention
 * and mapped to SDF Y internally.
 *
 * Ball nose contact math:
 *   offset_sdf = shape.round(R)      // expand surface by tool radius
 *   y_center = findSurface(...)       // ball center Y (scanning -Y)
 *   y_tip = y_center - R             // tool tip (what G-code programs)
 */

import { SDF, Round } from './sdf.js';
import type { Vec3, BoundingBox } from './vec3.js';
import { extractContours } from './marching-squares.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  type: 'ballnose' | 'flat' | 'drill';
  diameter: number;
  radius: number;
  flute_length?: number;
  shank_diameter?: number;
}

export interface ToolpathPoint {
  x: number;
  y: number;
  z: number;
  type: 'rapid' | 'cut' | 'plunge';
}

export interface ToolpathParams {
  direction: 'x' | 'y';
  stepover_pct: number;
  point_spacing?: number;
  feed_rate: number;
  plunge_rate?: number;
  rpm: number;
  safe_z: number;
  approach_z?: number;
  z_top?: number;
  z_bottom?: number;
  zigzag?: boolean;
  boundary_overcut?: number;
}

export interface ToolpathStats {
  point_count: number;
  pass_count: number;
  cut_distance_mm: number;
  rapid_distance_mm: number;
  estimated_time_min: number;
  z_min: number;
  z_max: number;
}

export interface ToolpathResult {
  kind: 'surfacing';
  id: string;
  tool: ToolDefinition;
  params: ToolpathParams;
  shape_name: string;
  points: ToolpathPoint[];
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] };
  stats: ToolpathStats;
}

// ─── Drop along Y ──────────────────────────────────────────────
//
// SDF.dropCutter() scans along -Z. We need to scan along -Y (down
// in SDF Y-up convention). Use findSurface() directly with [0,-1,0].

function dropAlongY(
  shape: SDF,
  x: number,
  z: number,
  yTop: number,
  yBottom: number,
  tolerance = 1e-7,
): number | null {
  const t = shape.findSurface(
    [x, yTop, z],
    [0, -1, 0],
    0,
    yTop - yBottom,
    tolerance,
  );
  if (t === null) return null;
  return yTop - t;
}

// ─── Core Algorithm ─────────────────────────────────────────────

export function generateRasterSurfacing(
  shape: SDF,
  tool: ToolDefinition,
  params: ToolpathParams,
): Omit<ToolpathResult, 'id'> {
  if (tool.type !== 'ballnose') {
    throw new Error(
      `generateRasterSurfacing() requires a ballnose tool, got '${tool.type}'. ` +
      `Use generateContourToolpath() for flat endmill profiling.`
    );
  }
  const R = tool.radius;
  if (R <= 0) throw new Error('Tool radius must be positive');

  const stepover = tool.diameter * (params.stepover_pct / 100);
  if (stepover <= 0) throw new Error('Stepover must be positive (stepover_pct > 0)');

  const spacing = params.point_spacing ?? stepover;
  if (spacing <= 0) throw new Error('Point spacing must be positive');

  const zigzag = params.zigzag ?? true;

  // Expand SDF surface outward by ball nose radius.
  // Round(shape, R) subtracts R from SDF values → isosurface expands by R.
  // Drop cutter on this offset SDF finds the ball CENTER position.
  const offsetShape = new Round(shape, R);

  // SDF bounds (Y-up)
  const sdfBounds = shape.bounds();
  const overcut = params.boundary_overcut ?? R;

  // Raster grid is in SDF XZ plane (= CNC XY plane)
  // CNC 'x' direction = SDF X, CNC 'y' direction = SDF Z
  let primaryMin: number, primaryMax: number;
  let secondaryMin: number, secondaryMax: number;

  if (params.direction === 'x') {
    // Cut along SDF X (CNC X), step in SDF Z (CNC Y)
    primaryMin = sdfBounds.min[0] - overcut;
    primaryMax = sdfBounds.max[0] + overcut;
    secondaryMin = sdfBounds.min[2] - overcut;
    secondaryMax = sdfBounds.max[2] + overcut;
  } else {
    // Cut along SDF Z (CNC Y), step in SDF X (CNC X)
    primaryMin = sdfBounds.min[2] - overcut;
    primaryMax = sdfBounds.max[2] + overcut;
    secondaryMin = sdfBounds.min[0] - overcut;
    secondaryMax = sdfBounds.max[0] + overcut;
  }

  // CNC safe_z / z_top / z_bottom → SDF Y values
  // These are specified in CNC Z-up convention, which maps to SDF Y
  const safeY = params.safe_z;
  const approachY = params.approach_z ?? (sdfBounds.max[1] + 5);
  const yTop = params.z_top ?? sdfBounds.max[1] + 10;
  const yBottom = params.z_bottom ?? sdfBounds.min[1] - 5;

  const points: ToolpathPoint[] = [];
  let passIndex = 0;

  // Walk secondary axis (stepover direction)
  for (let sec = secondaryMin; sec <= secondaryMax + 1e-9; sec += stepover) {
    const reverse = zigzag && (passIndex % 2 === 1);
    const pStart = reverse ? primaryMax : primaryMin;
    const pStep = reverse ? -spacing : spacing;

    let passHasPoints = false;
    let firstCut = true;
    const passPoints: ToolpathPoint[] = [];

    // Walk primary axis (cut direction)
    const steps = Math.ceil(Math.abs(primaryMax - primaryMin) / spacing) + 1;
    for (let i = 0; i < steps; i++) {
      let p = pStart + i * pStep;
      // Clamp to not overshoot
      if (!reverse && p > primaryMax) p = primaryMax;
      if (reverse && p < primaryMin) p = primaryMin;

      // SDF coordinates: X and Z are the raster plane
      const sdfX = params.direction === 'x' ? p : sec;
      const sdfZ = params.direction === 'x' ? sec : p;

      // Drop along -Y to find surface contact
      const yCenter = dropAlongY(offsetShape, sdfX, sdfZ, yTop, yBottom);
      if (yCenter === null) continue; // No surface — air region

      const yTip = yCenter - R;
      passHasPoints = true;

      // Output in SDF convention: (sdfX, sdfY, sdfZ)
      // point.y = SDF Y = CNC Z (height / spindle axis)
      if (firstCut) {
        passPoints.push({ x: sdfX, y: safeY, z: sdfZ, type: 'rapid' });
        passPoints.push({ x: sdfX, y: approachY, z: sdfZ, type: 'rapid' });
        passPoints.push({ x: sdfX, y: yTip, z: sdfZ, type: 'plunge' });
        firstCut = false;
      } else {
        passPoints.push({ x: sdfX, y: yTip, z: sdfZ, type: 'cut' });
      }
    }

    if (passHasPoints) {
      points.push(...passPoints);
      // Retract at end of pass
      const lastPt = passPoints[passPoints.length - 1];
      points.push({ x: lastPt.x, y: safeY, z: lastPt.z, type: 'rapid' });
      passIndex++;
    }
  }

  // Compute statistics
  const stats = computeStats(points, params);

  // Compute Y bounds from cut points (stored in point.y = SDF Y)
  const cutPoints = points.filter(p => p.type === 'cut' || p.type === 'plunge');
  const yValues = cutPoints.map(p => p.y);
  const yMin = yValues.length > 0 ? Math.min(...yValues) : 0;
  const yMax = yValues.length > 0 ? Math.max(...yValues) : 0;

  return {
    kind: 'surfacing' as const,
    tool,
    params,
    shape_name: shape.name,
    points,
    bounds: {
      x: [sdfBounds.min[0] - overcut, sdfBounds.max[0] + overcut],
      y: [yMin, yMax],
      z: [sdfBounds.min[2] - overcut, sdfBounds.max[2] + overcut],
    },
    stats: { ...stats, z_min: yMin, z_max: yMax },
  };
}

// ─── Statistics ─────────────────────────────────────────────────

function computeStats(
  points: ToolpathPoint[],
  params: { safe_z: number; feed_rate: number; plunge_rate?: number },
): Omit<ToolpathStats, 'z_min' | 'z_max'> {
  let cutDist = 0;
  let rapidDist = 0;
  let passCount = 0;
  const rapidRate = 15000; // mm/min assumption for time estimate

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dz = curr.z - prev.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (curr.type === 'cut' || curr.type === 'plunge') {
      cutDist += dist;
    } else {
      rapidDist += dist;
    }

    // Count passes (retract to safe height after cutting = end of pass)
    if (curr.type === 'rapid' && curr.y === params.safe_z &&
        (prev.type === 'cut' || prev.type === 'plunge')) {
      passCount++;
    }
  }

  const plungeRate = params.plunge_rate ?? params.feed_rate / 3;
  const cutTime = cutDist / params.feed_rate;
  const rapidTime = rapidDist / rapidRate;
  const estimatedTime = cutTime + rapidTime;

  return {
    point_count: points.length,
    pass_count: passCount,
    cut_distance_mm: Math.round(cutDist * 100) / 100,
    rapid_distance_mm: Math.round(rapidDist * 100) / 100,
    estimated_time_min: Math.round(estimatedTime * 100) / 100,
  };
}

// ─── Contour Toolpath ───────────────────────────────────────────
//
// 2D profile following at a fixed Z level (CNC convention).
// Uses marching squares on an SDF cross-section, offset by tool radius.

export interface BaseContourParams {
  direction?: 'climb' | 'conventional';  // default: 'climb'
  point_spacing?: number;       // mm along contour (default: 0.5)
  feed_rate: number;
  plunge_rate?: number;
  rpm: number;
  safe_z: number;
  resolution?: number;          // marching squares cell size (default: 1.0 mm)
}

export interface ContourToolpathParams extends BaseContourParams {
  z_level: number;              // CNC Z level (maps to SDF Y)
}

export interface MultiLevelContourParams extends BaseContourParams {
  z_top: number;                // CNC Z start (highest level)
  z_bottom: number;             // CNC Z end (lowest level)
  step_down: number;            // Depth per level (positive, mm)
  leave_stock?: number;         // Radial material allowance (default: 0)
}

export interface ContourToolpathResult {
  kind: 'contour';
  id: string;
  tool: ToolDefinition;
  params: ContourToolpathParams;
  shape_name: string;
  points: ToolpathPoint[];
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] };
  stats: ToolpathStats;
  loop_count: number;
}

export interface MultiLevelContourResult {
  kind: 'multilevel_contour';
  id: string;
  tool: ToolDefinition;
  params: MultiLevelContourParams;
  shape_name: string;
  points: ToolpathPoint[];
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] };
  stats: ToolpathStats;
  loop_count: number;
}

/**
 * Extract contour loops at a single Y level and append toolpath points.
 * Shared by single-level and multi-level contour generation.
 *
 * Returns the number of loops appended.
 */
function appendContourLevel(
  offsetShape: SDF,
  sdfY: number,
  safeY: number,
  climb: boolean,
  spacing: number,
  cellSize: number,
  gridBounds: { xMin: number; xMax: number; zMin: number; zMax: number },
  points: ToolpathPoint[],
): number {
  const loops = extractContours(
    (x, z) => offsetShape.evaluate([x, sdfY, z]),
    gridBounds,
    cellSize,
  );

  let loopCount = 0;

  for (const loop of loops) {
    if (loop.points.length < 2) continue;

    const resampled = resampleLoop(loop.points, loop.closed, spacing);
    if (resampled.length < 2) continue;

    const ordered = climb ? resampled : [...resampled].reverse();

    // Approach: rapid to safe Z, rapid to start XZ, plunge to cut Z
    const [sx, sz] = ordered[0];
    points.push({ x: sx, y: safeY, z: sz, type: 'rapid' });
    points.push({ x: sx, y: sdfY, z: sz, type: 'plunge' });

    // Walk the contour
    for (let i = 1; i < ordered.length; i++) {
      const [cx, cz] = ordered[i];
      points.push({ x: cx, y: sdfY, z: cz, type: 'cut' });
    }

    // Close the loop if it's closed (return to start)
    if (loop.closed && ordered.length > 2) {
      const [fx, fz] = ordered[0];
      points.push({ x: fx, y: sdfY, z: fz, type: 'cut' });
    }

    // Retract to safe Z
    const lastPt = points[points.length - 1];
    points.push({ x: lastPt.x, y: safeY, z: lastPt.z, type: 'rapid' });

    loopCount++;
  }

  return loopCount;
}

/**
 * Compute grid bounds for contour extraction with margin.
 */
function contourGridBounds(
  shape: SDF,
  margin: number,
): { xMin: number; xMax: number; zMin: number; zMax: number } {
  const sdfBounds = shape.bounds();
  return {
    xMin: sdfBounds.min[0] - margin,
    xMax: sdfBounds.max[0] + margin,
    zMin: sdfBounds.min[2] - margin,
    zMax: sdfBounds.max[2] + margin,
  };
}

/**
 * Generate a 2D contour toolpath at a fixed Z level.
 *
 * The tool center path is computed via SDF offset:
 *   Round(shape, R) expands the surface outward by R.
 *   The zero-contour of this offset SDF is where the flat endmill center
 *   should travel to just touch the original surface.
 *
 * Coordinate convention:
 *   z_level is in CNC Z-up convention, maps directly to SDF Y.
 *   Marching squares grid is in SDF XZ plane at y = z_level.
 *   Points stored in SDF convention (Y-up). G-code emitter swaps Y↔Z.
 */
export function generateContourToolpath(
  shape: SDF,
  tool: ToolDefinition,
  params: ContourToolpathParams,
): Omit<ContourToolpathResult, 'id'> {
  const R = tool.radius;
  if (R <= 0) throw new Error('Tool radius must be positive');

  const sdfY = params.z_level;
  const safeY = params.safe_z;
  const spacing = params.point_spacing ?? 0.5;
  const cellSize = params.resolution ?? 1.0;
  const climb = (params.direction ?? 'climb') === 'climb';

  const offsetShape = new Round(shape, R);
  const margin = R + cellSize * 2;
  const gridBounds = contourGridBounds(shape, margin);

  const points: ToolpathPoint[] = [];
  const loopCount = appendContourLevel(
    offsetShape, sdfY, safeY, climb, spacing, cellSize, gridBounds, points,
  );

  const stats = computeStats(points, params);

  return {
    kind: 'contour' as const,
    tool,
    params,
    shape_name: shape.name,
    points,
    bounds: {
      x: [gridBounds.xMin, gridBounds.xMax],
      y: [sdfY, sdfY],
      z: [gridBounds.zMin, gridBounds.zMax],
    },
    stats: { ...stats, z_min: sdfY, z_max: sdfY },
    loop_count: loopCount,
  };
}

/**
 * Generate multi-level contour toolpath (Z-level waterline roughing).
 *
 * Loops from z_top down to z_bottom in step_down increments.
 * Each level extracts contours via marching squares on the SDF cross-section,
 * offset by tool radius + leave_stock.
 *
 * All points go into one unified ToolpathPoint[] array with retract-rapids
 * between levels. The existing G-code emitter and viewer renderer work directly.
 */
export function generateMultiLevelContour(
  shape: SDF,
  tool: ToolDefinition,
  params: MultiLevelContourParams,
): Omit<MultiLevelContourResult, 'id'> {
  const R = tool.radius;
  if (R <= 0) throw new Error('Tool radius must be positive');
  if (params.step_down <= 0) throw new Error('step_down must be positive');
  if (params.z_top < params.z_bottom) {
    throw new Error(
      `z_top (${params.z_top}) must be >= z_bottom (${params.z_bottom}). ` +
      `z_top is the starting height, z_bottom is the final depth.`
    );
  }
  if (params.safe_z <= params.z_top) {
    throw new Error(
      `safe_z (${params.safe_z}) must be > z_top (${params.z_top}) for safe retract.`
    );
  }

  const leaveStock = params.leave_stock ?? 0;
  const rEffective = R + leaveStock;
  const spacing = params.point_spacing ?? 0.5;
  const cellSize = params.resolution ?? 1.0;
  const climb = (params.direction ?? 'climb') === 'climb';
  const safeY = params.safe_z;

  // Offset SDF by effective tool radius (tool radius + leave stock)
  const offsetShape = new Round(shape, rEffective);
  const margin = rEffective + cellSize * 2;
  const gridBounds = contourGridBounds(shape, margin);

  const points: ToolpathPoint[] = [];
  let totalLoops = 0;

  // Walk from z_top down to z_bottom in step_down increments
  for (let z = params.z_top; z >= params.z_bottom - 1e-9; z -= params.step_down) {
    // Clamp to z_bottom to avoid floating point overshoot
    const sdfY = Math.max(z, params.z_bottom);

    const loops = appendContourLevel(
      offsetShape, sdfY, safeY, climb, spacing, cellSize, gridBounds, points,
    );
    totalLoops += loops;

    // If we've reached z_bottom, stop
    if (sdfY <= params.z_bottom + 1e-9) break;
  }

  const stats = computeStats(points, params);

  // Compute Y bounds from cut points (single pass, no spread)
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of points) {
    if (p.type === 'cut' || p.type === 'plunge') {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  if (yMin === Infinity) { yMin = params.z_bottom; yMax = params.z_top; }

  return {
    kind: 'multilevel_contour' as const,
    tool,
    params,
    shape_name: shape.name,
    points,
    bounds: {
      x: [gridBounds.xMin, gridBounds.xMax],
      y: [yMin, yMax],
      z: [gridBounds.zMin, gridBounds.zMax],
    },
    stats: { ...stats, z_min: yMin, z_max: yMax },
    loop_count: totalLoops,
  };
}

// ─── Resample Polyline ──────────────────────────────────────────

/** Resample a polyline to evenly-spaced points along the path. */
function resampleLoop(
  pts: [number, number][],
  closed: boolean,
  spacing: number,
): [number, number][] {
  if (pts.length < 2) return pts;

  // Build cumulative arc lengths
  const cumLen: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    cumLen.push(cumLen[i - 1] + Math.sqrt(dx * dx + dz * dz));
  }

  // If closed, add the closing segment
  if (closed) {
    const dx = pts[0][0] - pts[pts.length - 1][0];
    const dz = pts[0][1] - pts[pts.length - 1][1];
    cumLen.push(cumLen[cumLen.length - 1] + Math.sqrt(dx * dx + dz * dz));
  }

  const totalLen = cumLen[cumLen.length - 1];
  if (totalLen < spacing) return pts;

  const numPts = Math.max(2, Math.round(totalLen / spacing));
  const result: [number, number][] = [];

  // Build extended points array (include closing segment for closed loops)
  const extended = closed ? [...pts, pts[0]] : pts;

  let segIdx = 0;
  for (let i = 0; i < numPts; i++) {
    const target = (i / numPts) * totalLen;

    // Advance to the correct segment
    while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < target) {
      segIdx++;
    }

    const segLen = cumLen[segIdx + 1] - cumLen[segIdx];
    const t = segLen > 1e-12 ? (target - cumLen[segIdx]) / segLen : 0;

    const x = extended[segIdx][0] + t * (extended[segIdx + 1][0] - extended[segIdx][0]);
    const z = extended[segIdx][1] + t * (extended[segIdx + 1][1] - extended[segIdx][1]);
    result.push([x, z]);
  }

  return result;
}

// ─── Drill Cycles ───────────────────────────────────────────────
//
// Extract drillable holes from named topology and generate canned
// cycle toolpaths (G81 standard, G83 peck drill).

const HOLE_BARREL_RE = /^(hole_\d+)\.barrel$/;

export interface DrillHole {
  position: Vec3;
  diameter: number;
  depth: number;
  through: boolean;
  featureName: string;
}

export interface DrillCycleParams {
  cycle: 'standard' | 'peck';
  peck_depth?: number;
  r_clearance?: number;       // mm above hole top for R-plane (default: 2)
  feed_rate: number;
  rpm: number;
  safe_z: number;
}

export interface DrillCycleResult {
  kind: 'drill';
  id: string;
  holes: DrillHole[];
  tool: ToolDefinition;
  params: DrillCycleParams;
  shape_name: string;
  points: ToolpathPoint[];
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] };
  stats: ToolpathStats;
}

/**
 * Extract drillable holes from a shape's named topology.
 *
 * Walks face descriptors looking for `hole_N.barrel` cylindrical faces.
 * Returns position (SDF Y-up), diameter, depth, and through/blind flag.
 */
export function extractDrillHoles(shape: SDF): DrillHole[] {
  const faces = shape.faces();
  const bounds = shape.bounds();
  const holes: DrillHole[] = [];

  for (const face of faces) {
    const match = face.name.match(HOLE_BARREL_RE);
    if (!match) continue;

    const featureName = match[1]; // e.g. "hole_1"
    if (face.kind !== 'cylindrical') continue;
    if (!face.radius || !face.axis) continue;

    const diameter = face.radius * 2;
    const origin = face.origin ?? [0, 0, 0];
    const axis = face.axis;

    // Determine depth: prefer stored depth, fallback to ray-cast
    let depth: number;
    let through = false;

    if (face.depth != null && face.depth > 0) {
      depth = face.depth;
      // Check if hole goes through the entire part along its axis
      const partExtent = Math.abs(
        axis[0] * (bounds.max[0] - bounds.min[0]) +
        axis[1] * (bounds.max[1] - bounds.min[1]) +
        axis[2] * (bounds.max[2] - bounds.min[2])
      );
      through = depth >= partExtent - 0.01;
    } else {
      // Fallback: ray-cast along hole axis to find depth
      const maxDepth = 500;
      const rayStart: Vec3 = [
        origin[0] + axis[0] * 0.1,
        origin[1] + axis[1] * 0.1,
        origin[2] + axis[2] * 0.1,
      ];
      const rayDir: Vec3 = [-axis[0], -axis[1], -axis[2]];
      const t = shape.findSurface(rayStart, rayDir, 0, maxDepth);
      if (t !== null) {
        depth = t;
        through = false;
      } else {
        depth = maxDepth;
        through = true;
      }
    }

    // Compute hole top position in SDF convention
    // After orientToAxis(), barrel axis points INTO material.
    // Hole top = origin - axis * depth/2
    const holeTop: Vec3 = [
      origin[0] - axis[0] * depth / 2,
      origin[1] - axis[1] * depth / 2,
      origin[2] - axis[2] * depth / 2,
    ];

    holes.push({
      position: holeTop,
      diameter,
      depth,
      through,
      featureName,
    });
  }

  return holes;
}

/**
 * Generate a drill cycle toolpath from holes in a shape.
 *
 * Validates tool type (must be 'drill') and tool-vs-hole diameter
 * compatibility. Generates ToolpathPoint[] for visualization and
 * stats for readback.
 */
export function generateDrillCycle(
  shape: SDF,
  tool: ToolDefinition,
  params: DrillCycleParams,
): Omit<DrillCycleResult, 'id'> {
  if (tool.type !== 'drill') {
    throw new Error(
      `generateDrillCycle() requires a drill tool, got '${tool.type}'. ` +
      `Use defineTool('drill', diameter) to create a drill.`
    );
  }

  const holes = extractDrillHoles(shape);
  if (holes.length === 0) {
    throw new Error(
      'No drillable holes found. Use hole() to create holes with named topology, ' +
      'then generateDrillCycle() to extract drill positions.'
    );
  }

  // Validate tool diameter vs hole diameter (#031)
  for (const h of holes) {
    if (tool.diameter > h.diameter + 0.01) {
      throw new Error(
        `Drill D${tool.diameter} is larger than ${h.featureName} (D${h.diameter}). ` +
        `Use a drill no larger than the hole diameter.`
      );
    }
  }

  const rClearance = params.r_clearance ?? 2;
  const safeY = params.safe_z;
  const points: ToolpathPoint[] = [];

  for (const h of holes) {
    const hx = h.position[0];
    const holeTopY = h.position[1];
    const hz = h.position[2];
    const holeBottomY = holeTopY - h.depth;

    // Rapid to safe Z above hole
    points.push({ x: hx, y: safeY, z: hz, type: 'rapid' });
    // Rapid to R-plane (just above hole top)
    points.push({ x: hx, y: holeTopY + rClearance, z: hz, type: 'rapid' });

    if (params.cycle === 'peck') {
      const peckDepth = params.peck_depth ?? tool.diameter * 1.5;
      let currentY = holeTopY;

      while (currentY > holeBottomY + 1e-9) {
        const nextY = Math.max(currentY - peckDepth, holeBottomY);
        // Plunge to next peck depth
        points.push({ x: hx, y: nextY, z: hz, type: 'plunge' });
        // Retract to R-plane
        points.push({ x: hx, y: holeTopY + rClearance, z: hz, type: 'rapid' });
        currentY = nextY;
      }
    } else {
      // Standard: single plunge to full depth
      points.push({ x: hx, y: holeBottomY, z: hz, type: 'plunge' });
    }

    // Retract to safe Z
    points.push({ x: hx, y: safeY, z: hz, type: 'rapid' });
  }

  const stats = computeStats(points, params);

  // Compute bounds from hole positions (#030)
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (const p of points) {
    if (p.type === 'cut' || p.type === 'plunge') {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
    }
  }
  if (xMin === Infinity) {
    xMin = xMax = yMin = yMax = zMin = zMax = 0;
  }

  return {
    kind: 'drill' as const,
    holes,
    tool,
    params,
    shape_name: shape.name,
    points,
    bounds: { x: [xMin, xMax], y: [yMin, yMax], z: [zMin, zMax] },
    stats: { ...stats, z_min: yMin, z_max: yMax },
  };
}
