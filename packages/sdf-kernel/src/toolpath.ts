/**
 * Toolpath Generation — 3-axis ball nose surface finishing.
 *
 * Generates parallel raster toolpaths directly from SDF geometry
 * via drop cutter. No mesh intermediary — the SDF IS the geometry.
 *
 * Ball nose contact math:
 *   offset_sdf = shape.round(R)      // expand surface outward by tool radius
 *   z_center = offset_sdf.dropCutter(x, y, zTop, zBottom)  // ball center Z
 *   z_tip = z_center - R             // tool tip Z (what G-code programs)
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

  const safeZ = params.safe_z;
  const approachZ = params.approach_z ?? 5;
  const zigzag = params.zigzag ?? true;

  // Expand SDF surface outward by ball nose radius.
  // Round(shape, R) subtracts R from SDF values → isosurface expands by R.
  // Drop cutter on this offset SDF finds the ball CENTER position.
  const offsetShape = new Round(shape, R);

  // Get shape bounds for grid extents
  const shapeBounds = shape.bounds();
  const overcut = params.boundary_overcut ?? R;

  let primaryMin: number, primaryMax: number;
  let secondaryMin: number, secondaryMax: number;

  if (params.direction === 'x') {
    // Cut along X, step in Y
    primaryMin = shapeBounds.min[0] - overcut;
    primaryMax = shapeBounds.max[0] + overcut;
    secondaryMin = shapeBounds.min[1] - overcut;
    secondaryMax = shapeBounds.max[1] + overcut;
  } else {
    // Cut along Y, step in X
    primaryMin = shapeBounds.min[1] - overcut;
    primaryMax = shapeBounds.max[1] + overcut;
    secondaryMin = shapeBounds.min[0] - overcut;
    secondaryMax = shapeBounds.max[0] + overcut;
  }

  const zTop = params.z_top ?? shapeBounds.max[2] + 10;
  const zBottom = params.z_bottom ?? shapeBounds.min[2] - 5;

  const points: ToolpathPoint[] = [];
  let passIndex = 0;

  // Walk secondary axis (stepover direction)
  for (let sec = secondaryMin; sec <= secondaryMax + 1e-9; sec += stepover) {
    const reverse = zigzag && (passIndex % 2 === 1);
    const pStart = reverse ? primaryMax : primaryMin;
    const pEnd = reverse ? primaryMin : primaryMax;
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

      const x = params.direction === 'x' ? p : sec;
      const y = params.direction === 'x' ? sec : p;

      const zCenter = offsetShape.dropCutter(x, y, zTop, zBottom);
      if (zCenter === null) continue; // No surface — air region

      const zTip = zCenter - R;
      passHasPoints = true;

      if (firstCut) {
        // Rapid to start of pass, approach, then plunge
        passPoints.push({ x, y, z: safeZ, type: 'rapid' });
        passPoints.push({ x, y, z: approachZ, type: 'rapid' });
        passPoints.push({ x, y, z: zTip, type: 'plunge' });
        firstCut = false;
      } else {
        passPoints.push({ x, y, z: zTip, type: 'cut' });
      }
    }

    if (passHasPoints) {
      points.push(...passPoints);
      // Retract at end of pass
      const lastPt = passPoints[passPoints.length - 1];
      points.push({ x: lastPt.x, y: lastPt.y, z: safeZ, type: 'rapid' });
      passIndex++;
    }
  }

  // Compute statistics
  const stats = computeStats(points, params);

  // Compute Z bounds from cut points
  const cutPoints = points.filter(p => p.type === 'cut' || p.type === 'plunge');
  const zValues = cutPoints.map(p => p.z);
  const zMin = zValues.length > 0 ? Math.min(...zValues) : 0;
  const zMax = zValues.length > 0 ? Math.max(...zValues) : 0;

  return {
    tool,
    params,
    shape_name: shape.name,
    points,
    bounds: {
      x: [shapeBounds.min[0] - overcut, shapeBounds.max[0] + overcut],
      y: [shapeBounds.min[1] - overcut, shapeBounds.max[1] + overcut],
      z: [zMin, zMax],
    },
    stats: { ...stats, z_min: zMin, z_max: zMax },
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

  // Count passes (each safe_z rapid after cutting is end of a pass)
  for (let i = 1; i < points.length; i++) {
    if (points[i].type === 'rapid' && points[i].z === params.safe_z &&
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
