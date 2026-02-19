import { describe, it, expect } from 'vitest';
import { box, sphere } from '../src/api.js';
import { generateRasterSurfacing } from '../src/toolpath.js';
import type { ToolDefinition, ToolpathParams } from '../src/toolpath.js';

const EPSILON = 0.1; // Toolpath accuracy depends on bounds estimation + surface finding

function near(actual: number, expected: number, tol = EPSILON) {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
}

function makeTool(diameter: number): ToolDefinition {
  return { name: 'T1', type: 'ballnose', diameter, radius: diameter / 2 };
}

function makeParams(overrides?: Partial<ToolpathParams>): ToolpathParams {
  return {
    direction: 'x',
    stepover_pct: 50,
    feed_rate: 2000,
    rpm: 10000,
    safe_z: 50,
    ...overrides,
  };
}

// Coordinate convention:
//   Points are in SDF/viewer convention (Y-up).
//   pt.x = SDF X (CNC X)
//   pt.y = SDF Y (CNC Z / spindle — height axis)
//   pt.z = SDF Z (CNC Y — depth axis)
//
//   box(100, 60, 30):
//     SDF X: -50..50, SDF Y: -30..30 (height), SDF Z: -15..15 (depth)
//     Box "top" face is at pt.y = 30

describe('generateRasterSurfacing', () => {

  describe('flat box — ball nose offset sanity', () => {
    // Box centered at origin: 100×60×30. Top at Y=30 (SDF Y-up).
    // Ball nose R=5: offset SDF top at Y=35.
    // Drop along -Y on offset → y_center=35. y_tip = 35-5 = 30.
    const shape = box(100, 60, 30);
    const tool = makeTool(10); // R=5

    it('generates points with Y (height) near the flat surface', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50, // 5mm stepover
        point_spacing: 10, // 10mm spacing along X for fast test
      }));

      expect(result.points.length).toBeGreaterThan(0);
      expect(result.stats.pass_count).toBeGreaterThan(0);

      // All cut/plunge points should have Y near 30 (flat box top)
      const cutPoints = result.points.filter(p => p.type === 'cut' || p.type === 'plunge');
      expect(cutPoints.length).toBeGreaterThan(0);

      for (const pt of cutPoints) {
        near(pt.y, 30, 1.0); // Within 1mm — box top is at Y=30
      }
    });

    it('returns correct stats', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50,
        point_spacing: 10,
      }));

      expect(result.stats.point_count).toBe(result.points.length);
      expect(result.stats.pass_count).toBeGreaterThan(0);
      expect(result.stats.cut_distance_mm).toBeGreaterThan(0);
      expect(result.stats.rapid_distance_mm).toBeGreaterThan(0);
      expect(result.stats.estimated_time_min).toBeGreaterThan(0);
    });
  });

  describe('sphere — curved surface', () => {
    // Sphere R=20. At (0,0): surface at Y=20 (SDF Y-up).
    // Ball nose R=3. Offset: surface at Y=23.
    // y_center = 23, y_tip = 23-3 = 20. Should match sphere top.
    const shape = sphere(20);
    const tool = makeTool(6); // R=3

    it('Y at center is near sphere top', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50, // 3mm stepover
        point_spacing: 5,
      }));

      const cutPoints = result.points.filter(p => p.type === 'cut' || p.type === 'plunge');
      expect(cutPoints.length).toBeGreaterThan(0);

      // Find point closest to center in XZ plane (raster plane)
      let closest = cutPoints[0];
      let closestDist = Infinity;
      for (const pt of cutPoints) {
        const d = Math.sqrt(pt.x * pt.x + pt.z * pt.z);
        if (d < closestDist) {
          closestDist = d;
          closest = pt;
        }
      }

      // Y near center should be close to 20 (sphere top)
      near(closest.y, 20, 1.5);
    });

    it('Y decreases toward edges', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50,
        point_spacing: 5,
      }));

      const cutPoints = result.points.filter(p => p.type === 'cut' || p.type === 'plunge');
      const yValues = cutPoints.map(p => p.y);
      const yMax = Math.max(...yValues);
      const yMin = Math.min(...yValues);

      // Sphere curves down → Y range should be significant
      expect(yMax - yMin).toBeGreaterThan(5);
    });
  });

  describe('zigzag vs unidirectional', () => {
    const shape = box(100, 60, 30);
    const tool = makeTool(10);

    it('zigzag alternates direction', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50,
        point_spacing: 10,
        zigzag: true,
      }));

      // Find rapid points at safe height (pass starts)
      // safe_z is in pt.y (SDF Y = height axis)
      const passStarts = result.points.filter(
        (p, i) => p.type === 'rapid' && p.y === 50 &&
        i + 1 < result.points.length && result.points[i + 1].type === 'rapid' &&
        result.points[i + 1].y !== 50
      );

      if (passStarts.length >= 2) {
        // First pass starts from one X extreme, second from opposite
        const x0 = passStarts[0].x;
        const x1 = passStarts[1].x;
        // They should be on opposite sides (zigzag)
        expect(Math.abs(x0 - x1)).toBeGreaterThan(10);
      }
    });

    it('unidirectional all passes start from same side', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50,
        point_spacing: 10,
        zigzag: false,
      }));

      // Find plunge points (first cutting move of each pass)
      const plunges = result.points.filter(p => p.type === 'plunge');
      if (plunges.length >= 2) {
        const x0 = plunges[0].x;
        const x1 = plunges[1].x;
        // Same start X (within tolerance)
        near(x0, x1, 1.0);
      }
    });
  });

  describe('direction parameter', () => {
    const shape = box(100, 60, 30);
    const tool = makeTool(10);

    it('direction=x: cuts along X, steps in Z (CNC Y)', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        direction: 'x',
        stepover_pct: 50,
        point_spacing: 10,
      }));

      // Within a pass (consecutive cut points), Z should be constant
      // (Z = SDF Z = CNC Y = stepover axis)
      const cutPoints = result.points.filter(p => p.type === 'cut');
      if (cutPoints.length >= 2) {
        expect(cutPoints[0].z).toBe(cutPoints[1].z);
      }
    });

    it('direction=y: cuts along Z (CNC Y), steps in X', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        direction: 'y',
        stepover_pct: 50,
        point_spacing: 10,
      }));

      // Within a pass, X should be constant
      const cutPoints = result.points.filter(p => p.type === 'cut');
      if (cutPoints.length >= 2) {
        expect(cutPoints[0].x).toBe(cutPoints[1].x);
      }
    });
  });

  describe('safe Z retracts', () => {
    const shape = box(100, 60, 30);
    const tool = makeTool(10);

    it('each pass ends with a retract to safe height', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50,
        point_spacing: 10,
      }));

      // Count retracts: rapid moves to safe_z (in pt.y) after cutting
      let retractCount = 0;
      for (let i = 1; i < result.points.length; i++) {
        if (result.points[i].type === 'rapid' && result.points[i].y === 50 &&
            (result.points[i - 1].type === 'cut' || result.points[i - 1].type === 'plunge')) {
          retractCount++;
        }
      }
      expect(retractCount).toBe(result.stats.pass_count);
    });
  });

  describe('edge cases', () => {
    it('throws on zero stepover_pct', () => {
      const shape = box(100, 60, 30);
      const tool = makeTool(10);
      expect(() => generateRasterSurfacing(shape, tool, makeParams({ stepover_pct: 0 })))
        .toThrow();
    });

    it('handles small shape (smaller than tool)', () => {
      const shape = box(5, 5, 5); // 5mm cube, tool is 10mm diameter
      const tool = makeTool(10);
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50,
        point_spacing: 2,
      }));
      // Should still produce some points (boundary overcut extends past shape)
      expect(result.points.length).toBeGreaterThan(0);
    });
  });
});
