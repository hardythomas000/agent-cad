import { describe, it, expect } from 'vitest';
import { box, sphere } from '../src/api.js';
import { generateRasterSurfacing } from '../src/toolpath.js';
import type { ToolDefinition, ToolpathParams } from '../src/toolpath.js';

const EPSILON = 0.1; // Toolpath Z accuracy depends on bounds estimation + drop cutter

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

describe('generateRasterSurfacing', () => {

  describe('flat box — ball nose offset sanity', () => {
    // Box centered at origin: 100x60x30. Top at Z=15.
    // Ball nose R=5: offset SDF top at Z=20.
    // Drop cutter on offset → z_center=20. z_tip = 20-5 = 15. Should match surface.
    const shape = box(100, 60, 30);
    const tool = makeTool(10); // R=5

    it('generates points with Z near the flat surface', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50, // 5mm stepover
        point_spacing: 10, // 10mm spacing along X for fast test
      }));

      expect(result.points.length).toBeGreaterThan(0);
      expect(result.stats.pass_count).toBeGreaterThan(0);

      // All cut/plunge points should have Z near 15 (flat box top)
      const cutPoints = result.points.filter(p => p.type === 'cut' || p.type === 'plunge');
      expect(cutPoints.length).toBeGreaterThan(0);

      for (const pt of cutPoints) {
        near(pt.z, 15, 1.0); // Within 1mm — box top is at Z=15
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
    // Sphere R=20. At (0,0): surface at Z=20.
    // Ball nose R=3. Offset: surface at Z=23.
    // z_center = 23, z_tip = 23-3 = 20. Should match sphere top.
    const shape = sphere(20);
    const tool = makeTool(6); // R=3

    it('Z at center is near sphere top', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50, // 3mm stepover
        point_spacing: 5,
      }));

      const cutPoints = result.points.filter(p => p.type === 'cut' || p.type === 'plunge');
      expect(cutPoints.length).toBeGreaterThan(0);

      // Find point closest to (0, 0)
      let closest = cutPoints[0];
      let closestDist = Infinity;
      for (const pt of cutPoints) {
        const d = Math.sqrt(pt.x * pt.x + pt.y * pt.y);
        if (d < closestDist) {
          closestDist = d;
          closest = pt;
        }
      }

      // Z near center should be close to 20 (sphere top)
      near(closest.z, 20, 1.5);
    });

    it('Z decreases toward edges', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50,
        point_spacing: 5,
      }));

      const cutPoints = result.points.filter(p => p.type === 'cut' || p.type === 'plunge');
      const zValues = cutPoints.map(p => p.z);
      const zMax = Math.max(...zValues);
      const zMin = Math.min(...zValues);

      // Sphere curves down → Z range should be significant
      expect(zMax - zMin).toBeGreaterThan(5);
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

      // Find rapid points at safe_z (pass starts)
      const passStarts = result.points.filter(
        (p, i) => p.type === 'rapid' && p.z === 50 &&
        i + 1 < result.points.length && result.points[i + 1].type === 'rapid' &&
        result.points[i + 1].z !== 50
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

    it('direction=x: cuts along X, steps in Y', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        direction: 'x',
        stepover_pct: 50,
        point_spacing: 10,
      }));

      // Within a pass (consecutive cut points), Y should be constant
      const cutPoints = result.points.filter(p => p.type === 'cut');
      if (cutPoints.length >= 2) {
        // First two consecutive cuts should have same Y
        expect(cutPoints[0].y).toBe(cutPoints[1].y);
      }
    });

    it('direction=y: cuts along Y, steps in X', () => {
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

    it('each pass ends with a retract to safe_z', () => {
      const result = generateRasterSurfacing(shape, tool, makeParams({
        stepover_pct: 50,
        point_spacing: 10,
      }));

      // Count retracts: rapid moves to safe_z after cutting
      let retractCount = 0;
      for (let i = 1; i < result.points.length; i++) {
        if (result.points[i].type === 'rapid' && result.points[i].z === 50 &&
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
