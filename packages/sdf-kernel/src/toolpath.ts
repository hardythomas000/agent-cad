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

// ─── Types ──────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  type: 'ballnose';
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
  params: ToolpathParams,
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

    if (curr.type === 'cut') {
      cutDist += dist;
    } else if (curr.type === 'plunge') {
      cutDist += dist; // plunge is a cutting move at plunge rate
    } else {
      rapidDist += dist;
    }
  }

  // Count passes (retract to safe height after cutting = end of pass)
  for (let i = 1; i < points.length; i++) {
    if (points[i].type === 'rapid' && points[i].y === params.safe_z &&
        i > 0 && (points[i - 1].type === 'cut' || points[i - 1].type === 'plunge')) {
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
