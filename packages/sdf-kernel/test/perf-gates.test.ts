/**
 * Performance gates — timed assertions that catch algorithmic regressions.
 *
 * Each test asserts correctness AND that wall-clock time stays under budget.
 * Budgets are set at 3x observed time on a mid-range dev machine (Node 22),
 * with a 50ms floor to absorb OS scheduling jitter.
 *
 * Calibrated 2026-02-20: sphere=24ms, CSG=50ms, raster=17ms, contour=5ms, squares=3ms.
 *
 * If a gate fails: profile the function, don't just bump the budget.
 */

import { describe, it, expect } from 'vitest';
import { box, sphere, cylinder, subtract } from '../src/api.js';
import { marchingCubes } from '../src/marching-cubes.js';
import { generateRasterSurfacing, generateContourToolpath } from '../src/toolpath.js';
import type { ToolDefinition, ToolpathParams, ContourToolpathParams } from '../src/toolpath.js';
import { extractContours } from '../src/marching-squares.js';

/** Run fn, return [result, elapsed_ms]. */
function timed<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const result = fn();
  return [result, performance.now() - t0];
}

function makeBallnoseTool(diameter: number): ToolDefinition {
  return { name: `bn${diameter}`, type: 'ballnose', diameter, radius: diameter / 2 };
}

function makeFlatTool(diameter: number): ToolDefinition {
  return { name: `flat${diameter}`, type: 'flat', diameter, radius: diameter / 2 };
}

describe('performance gates', () => {

  // ─── Marching Cubes ──────────────────────────────────────

  describe('marchingCubes', () => {
    it('sphere r=20 at res=1 meshes within 75ms', () => {
      const shape = sphere(20);
      const [mesh, ms] = timed(() => marchingCubes(shape, 1));
      expect(mesh.triangleCount).toBeGreaterThan(0);
      expect(ms, `marchingCubes took ${ms.toFixed(0)}ms`).toBeLessThan(75);
    });

    it('complex CSG at res=1 meshes within 150ms', () => {
      const shape = subtract(
        subtract(box(100, 60, 30), cylinder(5, 40)),
        cylinder(8, 40),
      );
      const [mesh, ms] = timed(() => marchingCubes(shape, 1));
      expect(mesh.triangleCount).toBeGreaterThan(0);
      expect(ms, `marchingCubes CSG took ${ms.toFixed(0)}ms`).toBeLessThan(150);
    });
  });

  // ─── Raster Surfacing ────────────────────────────────────

  describe('generateRasterSurfacing', () => {
    it('box 100x60x30, 10% stepover, D8 ballnose within 50ms', () => {
      const shape = box(100, 60, 30);
      const tool = makeBallnoseTool(8);
      const params: ToolpathParams = {
        direction: 'x', stepover_pct: 10, zigzag: true,
        feed_rate: 4800, rpm: 12000, safe_z: 25,
      };
      const [tp, ms] = timed(() => generateRasterSurfacing(shape, tool, params));
      expect(tp.stats.point_count).toBeGreaterThan(100);
      expect(ms, `raster surfacing took ${ms.toFixed(0)}ms`).toBeLessThan(50);
    });
  });

  // ─── Contour Toolpath ────────────────────────────────────

  describe('generateContourToolpath', () => {
    it('box 80x40x60, D6 flat, z=20, res=1 within 50ms', () => {
      const shape = box(80, 40, 60);
      const tool = makeFlatTool(6);
      const params: ContourToolpathParams = {
        z_level: 20, direction: 'climb', feed_rate: 800,
        rpm: 8000, safe_z: 50, resolution: 1.0,
      };
      const [tp, ms] = timed(() => generateContourToolpath(shape, tool, params));
      expect(tp.stats.point_count).toBeGreaterThan(0);
      expect(ms, `contour toolpath took ${ms.toFixed(0)}ms`).toBeLessThan(50);
    });
  });

  // ─── Marching Squares ────────────────────────────────────

  describe('extractContours', () => {
    it('circle r=20, cellSize=0.5 (fine grid) within 50ms', () => {
      const R = 20;
      const sdf = (x: number, z: number) => Math.sqrt(x * x + z * z) - R;
      const [loops, ms] = timed(() =>
        extractContours(sdf, { xMin: -30, xMax: 30, zMin: -30, zMax: 30 }, 0.5),
      );
      expect(loops.length).toBe(1);
      expect(ms, `extractContours took ${ms.toFixed(0)}ms`).toBeLessThan(50);
    });
  });
});
