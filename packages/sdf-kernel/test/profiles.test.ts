/**
 * Tests for 2D profiles (Polygon2D, Circle2D, Rect2D) and
 * 2D→3D bridge operations (Extrude, Revolve).
 */

import { describe, it, expect } from 'vitest';
import {
  polygon, circle2d, rect2d, extrude, revolve,
  box, torus, marchingCubes,
} from '../src/index.js';

// ─── Polygon2D ─────────────────────────────────────────────────

describe('Polygon2D', () => {
  // Unit square: vertices at (0,0), (10,0), (10,10), (0,10)
  const square = polygon([[0, 0], [10, 0], [10, 10], [0, 10]]);

  it('center of square is inside', () => {
    expect(square.evaluate(5, 5)).toBeLessThan(0);
  });

  it('point well outside is positive', () => {
    expect(square.evaluate(20, 5)).toBeGreaterThan(0);
  });

  it('point on edge has ~zero distance', () => {
    expect(Math.abs(square.evaluate(5, 0))).toBeLessThan(1e-6);
  });

  it('point on vertex has ~zero distance', () => {
    expect(Math.abs(square.evaluate(0, 0))).toBeLessThan(1e-6);
  });

  it('distance to nearest edge is correct', () => {
    // Point at (5, -3) is 3mm below the bottom edge
    expect(square.evaluate(5, -3)).toBeCloseTo(3, 4);
  });

  it('distance inside is correct (negative)', () => {
    // Point at (5, 2) is 2mm from nearest edge (bottom)
    expect(square.evaluate(5, 2)).toBeCloseTo(-2, 4);
  });

  it('bounds are correct', () => {
    const b = square.bounds2d();
    expect(b.min[0]).toBeCloseTo(0);
    expect(b.min[1]).toBeCloseTo(0);
    expect(b.max[0]).toBeCloseTo(10);
    expect(b.max[1]).toBeCloseTo(10);
  });

  // Triangle
  const triangle = polygon([[0, 0], [10, 0], [5, 10]]);

  it('triangle center is inside', () => {
    expect(triangle.evaluate(5, 3)).toBeLessThan(0);
  });

  it('triangle outside point is positive', () => {
    expect(triangle.evaluate(0, 10)).toBeGreaterThan(0);
  });

  // Concave L-shape
  const lShape = polygon([
    [0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20],
  ]);

  it('L-shape: point in horizontal arm is inside', () => {
    expect(lShape.evaluate(15, 5)).toBeLessThan(0);
  });

  it('L-shape: point in vertical arm is inside', () => {
    expect(lShape.evaluate(5, 15)).toBeLessThan(0);
  });

  it('L-shape: point in concave notch is outside', () => {
    expect(lShape.evaluate(15, 15)).toBeGreaterThan(0);
  });

  it('rejects fewer than 3 vertices', () => {
    expect(() => polygon([[0, 0], [1, 0]])).toThrow();
  });

  it('readback2d returns correct info', () => {
    const rb = square.readback2d();
    expect(rb.name).toContain('polygon2d');
    expect(rb.size[0]).toBeCloseTo(10);
    expect(rb.size[1]).toBeCloseTo(10);
    expect(rb.center[0]).toBeCloseTo(5);
    expect(rb.center[1]).toBeCloseTo(5);
  });
});

// ─── Circle2D ──────────────────────────────────────────────────

describe('Circle2D', () => {
  const c = circle2d(10);

  it('origin is inside', () => {
    expect(c.evaluate(0, 0)).toBeCloseTo(-10);
  });

  it('point on boundary has zero distance', () => {
    expect(c.evaluate(10, 0)).toBeCloseTo(0, 4);
  });

  it('point outside is positive', () => {
    expect(c.evaluate(15, 0)).toBeCloseTo(5);
  });

  it('bounds are correct', () => {
    const b = c.bounds2d();
    expect(b.min).toEqual([-10, -10]);
    expect(b.max).toEqual([10, 10]);
  });

  it('rejects non-positive radius', () => {
    expect(() => circle2d(0)).toThrow();
    expect(() => circle2d(-5)).toThrow();
  });
});

// ─── Rect2D ────────────────────────────────────────────────────

describe('Rect2D', () => {
  const r = rect2d(20, 10); // 20mm wide, 10mm tall, centered

  it('origin is inside', () => {
    expect(r.evaluate(0, 0)).toBeLessThan(0);
  });

  it('center distance is correct', () => {
    // Nearest edge is 5mm away (top/bottom at ±5)
    expect(r.evaluate(0, 0)).toBeCloseTo(-5, 4);
  });

  it('point on edge has zero distance', () => {
    expect(r.evaluate(10, 0)).toBeCloseTo(0, 4);
  });

  it('outside point is positive', () => {
    expect(r.evaluate(15, 0)).toBeCloseTo(5, 4);
  });

  it('corner distance is correct', () => {
    // Point at (13, 8) is 3mm outside in X and 3mm outside in Y
    expect(r.evaluate(13, 8)).toBeCloseTo(Math.sqrt(9 + 9), 4);
  });

  it('bounds are correct', () => {
    const b = r.bounds2d();
    expect(b.min).toEqual([-10, -5]);
    expect(b.max).toEqual([10, 5]);
  });
});

// ─── Extrude ───────────────────────────────────────────────────

describe('Extrude', () => {
  // Extrude a 20x10 rectangle by 30mm → should behave like box(20, 10, 30)
  const extruded = extrude(rect2d(20, 10), 30);
  const refBox = box(20, 10, 30);

  it('center is inside', () => {
    expect(extruded.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('matches box at center', () => {
    expect(extruded.evaluate([0, 0, 0])).toBeCloseTo(refBox.evaluate([0, 0, 0]), 3);
  });

  it('matches box at face center', () => {
    // Front face of extruded rect should be at x=10
    expect(extruded.evaluate([10, 0, 0])).toBeCloseTo(0, 3);
    expect(refBox.evaluate([10, 0, 0])).toBeCloseTo(0, 3);
  });

  it('outside above is positive', () => {
    expect(extruded.evaluate([0, 0, 20])).toBeGreaterThan(0);
  });

  it('outside in XY is positive', () => {
    expect(extruded.evaluate([15, 0, 0])).toBeGreaterThan(0);
  });

  it('bounds are correct', () => {
    const b = extruded.bounds();
    expect(b.min[0]).toBeCloseTo(-10);
    expect(b.min[1]).toBeCloseTo(-5);
    expect(b.min[2]).toBeCloseTo(-15);
    expect(b.max[0]).toBeCloseTo(10);
    expect(b.max[1]).toBeCloseTo(5);
    expect(b.max[2]).toBeCloseTo(15);
  });

  it('rejects non-positive height', () => {
    expect(() => extrude(rect2d(10, 10), 0)).toThrow();
    expect(() => extrude(rect2d(10, 10), -5)).toThrow();
  });

  // Extruded polygon
  const extPoly = extrude(polygon([[0, 0], [50, 0], [50, 30], [0, 30]]), 20);

  it('extruded polygon center is inside', () => {
    expect(extPoly.evaluate([25, 15, 0])).toBeLessThan(0);
  });

  it('extruded polygon above top cap is outside', () => {
    expect(extPoly.evaluate([25, 15, 15])).toBeGreaterThan(0);
  });

  it('can mesh an extruded polygon', () => {
    const mesh = marchingCubes(extPoly, 2);
    expect(mesh.triangleCount).toBeGreaterThan(0);
  });
});

// ─── Revolve ───────────────────────────────────────────────────

describe('Revolve', () => {
  // Revolve a circle2d(10) at offset 30 → torus(R=30, r=10)
  const revolved = revolve(circle2d(10), 30);
  const refTorus = torus(30, 10);

  it('top of tube is on surface', () => {
    // At (30, 0, 10) — on the top of the tube at the major radius
    expect(revolved.evaluate([30, 0, 10])).toBeCloseTo(0, 3);
    expect(refTorus.evaluate([30, 0, 10])).toBeCloseTo(0, 3);
  });

  it('center of tube is inside', () => {
    // At (30, 0, 0) — center of the tube
    expect(revolved.evaluate([30, 0, 0])).toBeCloseTo(-10, 3);
    expect(refTorus.evaluate([30, 0, 0])).toBeCloseTo(-10, 3);
  });

  it('center of torus (origin) is outside', () => {
    expect(revolved.evaluate([0, 0, 0])).toBeGreaterThan(0);
  });

  it('matches torus at various points', () => {
    const testPoints: [number, number, number][] = [
      [30, 0, 0], [0, 30, 0], [-30, 0, 5], [21, 0, 0], [40, 0, 0],
    ];
    for (const p of testPoints) {
      expect(revolved.evaluate(p)).toBeCloseTo(refTorus.evaluate(p), 2);
    }
  });

  it('bounds are correct', () => {
    const b = revolved.bounds();
    expect(b.min[0]).toBeCloseTo(-40);
    expect(b.min[1]).toBeCloseTo(-40);
    expect(b.min[2]).toBeCloseTo(-10);
    expect(b.max[0]).toBeCloseTo(40);
    expect(b.max[1]).toBeCloseTo(40);
    expect(b.max[2]).toBeCloseTo(10);
  });

  it('can mesh a revolved shape', () => {
    const mesh = marchingCubes(revolved, 2);
    expect(mesh.triangleCount).toBeGreaterThan(0);
  });

  // Revolve a rect2d to make a washer/ring shape
  const ring = revolve(rect2d(6, 10), 20);

  it('ring center is inside at major radius', () => {
    expect(ring.evaluate([20, 0, 0])).toBeLessThan(0);
  });

  it('ring origin is outside', () => {
    expect(ring.evaluate([0, 0, 0])).toBeGreaterThan(0);
  });
});
