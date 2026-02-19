import { describe, it, expect } from 'vitest';
import { box, sphere, cylinder, subtract } from '../src/api.js';
import { generateRasterSurfacing, generateContourToolpath } from '../src/toolpath.js';
import { emitFanucGCode } from '../src/gcode.js';
import type { ToolDefinition, ToolpathParams, ContourToolpathParams } from '../src/toolpath.js';

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

// ═══════════════════════════════════════════════════════════════
// generateContourToolpath
// ═══════════════════════════════════════════════════════════════

function makeFlatTool(diameter: number): ToolDefinition {
  return { name: 'T2', type: 'flat', diameter, radius: diameter / 2 };
}

function makeContourParams(overrides?: Partial<ContourToolpathParams>): ContourToolpathParams {
  return {
    z_level: 0,
    feed_rate: 1000,
    rpm: 8000,
    safe_z: 50,
    ...overrides,
  };
}

describe('generateContourToolpath', () => {

  describe('box at mid-height', () => {
    // Box 100×60×30: SDF Y range = -30..30
    // At z_level = 0 (mid-height), cross-section is 100×30 (XZ plane)
    const shape = box(100, 60, 30);
    const tool = makeFlatTool(10); // R=5

    it('produces points for rectangular contour', () => {
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        resolution: 2.0,
      }));
      expect(result.points.length).toBeGreaterThan(0);
      expect(result.loop_count).toBeGreaterThanOrEqual(1);
    });

    it('all cut points are at z_level (SDF Y)', () => {
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 10,
        resolution: 2.0,
      }));
      const cutPoints = result.points.filter(p => p.type === 'cut' || p.type === 'plunge');
      expect(cutPoints.length).toBeGreaterThan(0);
      for (const pt of cutPoints) {
        expect(pt.y).toBe(10); // All at z_level
      }
    });

    it('contour is offset by tool radius from true boundary', () => {
      const R = 5; // tool radius
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        resolution: 1.0,
      }));
      const cutPoints = result.points.filter(p => p.type === 'cut');
      expect(cutPoints.length).toBeGreaterThan(0);

      // Box XZ cross-section at Y=0: X ∈ [-50, 50], Z ∈ [-15, 15]
      // With offset R=5: contour should be at X ≈ ±55, Z ≈ ±20
      // Find extremes
      const xMax = Math.max(...cutPoints.map(p => p.x));
      const zMax = Math.max(...cutPoints.map(p => p.z));

      // Contour X extreme should be ~55 (box half-width 50 + tool radius 5)
      expect(xMax).toBeGreaterThan(50);
      expect(xMax).toBeLessThan(60);
      // Contour Z extreme should be ~20 (box half-depth 15 + tool radius 5)
      expect(zMax).toBeGreaterThan(15);
      expect(zMax).toBeLessThan(25);
    });
  });

  describe('sphere — circular contour', () => {
    // Sphere R=20: at z_level=0 (SDF Y=0), cross-section in XZ plane is circle R=20
    const shape = sphere(20);
    const tool = makeFlatTool(6); // R=3

    it('produces a circular contour loop', () => {
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        resolution: 1.0,
      }));
      expect(result.loop_count).toBeGreaterThanOrEqual(1);
      const cutPoints = result.points.filter(p => p.type === 'cut');
      expect(cutPoints.length).toBeGreaterThan(0);

      // Offset contour should be ~23mm from center (sphere R=20 + tool R=3)
      for (const pt of cutPoints) {
        const dist = Math.sqrt(pt.x * pt.x + pt.z * pt.z);
        expect(dist).toBeGreaterThan(18);
        expect(dist).toBeLessThan(30);
      }
    });
  });

  describe('climb vs conventional', () => {
    const shape = box(100, 60, 30);
    const tool = makeFlatTool(10);

    it('climb and conventional produce different point orders', () => {
      const climb = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        direction: 'climb',
        resolution: 2.0,
      }));
      const conv = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        direction: 'conventional',
        resolution: 2.0,
      }));
      // Both should produce the same number of loops
      expect(climb.loop_count).toBe(conv.loop_count);
      // But the point order should differ
      const climbCuts = climb.points.filter(p => p.type === 'cut');
      const convCuts = conv.points.filter(p => p.type === 'cut');
      if (climbCuts.length > 2 && convCuts.length > 2) {
        // First few cut points should differ (reversed order)
        const climbFirst = climbCuts[0];
        const convFirst = convCuts[0];
        const same = climbFirst.x === convFirst.x && climbFirst.z === convFirst.z;
        // If they start at the same point, the second point should differ
        if (same && climbCuts.length > 1 && convCuts.length > 1) {
          expect(climbCuts[1].x !== convCuts[1].x || climbCuts[1].z !== convCuts[1].z).toBe(true);
        }
      }
    });
  });

  describe('safe Z and pass structure', () => {
    const shape = box(100, 60, 30);
    const tool = makeFlatTool(10);

    it('each loop starts and ends at safe Z', () => {
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        safe_z: 50,
        resolution: 2.0,
      }));
      // First point should be a rapid at safe_z
      expect(result.points[0].type).toBe('rapid');
      expect(result.points[0].y).toBe(50);
      // Last point should be a rapid at safe_z
      const last = result.points[result.points.length - 1];
      expect(last.type).toBe('rapid');
      expect(last.y).toBe(50);
    });
  });

  describe('G-code export', () => {
    const shape = box(100, 60, 30);
    const tool = makeFlatTool(10);

    it('produces valid Fanuc G-code', () => {
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        resolution: 2.0,
      }));
      const gcode = emitFanucGCode({ ...result, id: 'test' });
      expect(gcode).toContain('%');
      expect(gcode).toContain('G90');
      expect(gcode).toContain('G01');
      expect(gcode).toContain('M30');
      expect(gcode).toContain('CONTOUR PROFILING');
    });
  });

  describe('flat endmill rejected by raster surfacing', () => {
    it('throws when flat endmill used with generateRasterSurfacing', () => {
      const shape = box(100, 60, 30);
      const tool = makeFlatTool(10);
      expect(() => generateRasterSurfacing(shape, tool, makeParams()))
        .toThrow(/ballnose/);
    });
  });

  describe('multiple loops — box with hole', () => {
    it('produces multiple loops for shape with holes', () => {
      const base = box(100, 60, 30);
      const hole = cylinder(8, 80).translate(0, 0, 0);
      const shape = subtract(base, hole);
      const tool = makeFlatTool(6);
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        resolution: 1.5,
      }));
      // Should have at least 2 loops: outer box contour + inner hole contour
      expect(result.loop_count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('no geometry at Z level', () => {
    it('produces empty toolpath when Z level is above shape', () => {
      const shape = box(100, 60, 30); // Y range: -30..30
      const tool = makeFlatTool(10);
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 100, // Way above the box
        resolution: 2.0,
      }));
      expect(result.loop_count).toBe(0);
      expect(result.points.length).toBe(0);
    });
  });

  describe('statistics', () => {
    it('returns meaningful stats', () => {
      const shape = box(100, 60, 30);
      const tool = makeFlatTool(10);
      const result = generateContourToolpath(shape, tool, makeContourParams({
        z_level: 0,
        resolution: 2.0,
      }));
      expect(result.stats.point_count).toBe(result.points.length);
      expect(result.stats.cut_distance_mm).toBeGreaterThan(0);
      expect(result.stats.z_min).toBe(0);
      expect(result.stats.z_max).toBe(0);
    });
  });
});
