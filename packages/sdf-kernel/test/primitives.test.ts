import { describe, it, expect } from 'vitest';
import { box, sphere, cylinder, cone, torus, plane } from '../src/index.js';
import type { Vec3 } from '../src/index.js';

const EPSILON = 1e-5;

function near(actual: number, expected: number, tol = EPSILON) {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
}

describe('Sphere', () => {
  const s = sphere(10);

  it('returns 0 on surface', () => {
    near(s.evaluate([10, 0, 0]), 0);
    near(s.evaluate([0, 10, 0]), 0);
    near(s.evaluate([0, 0, 10]), 0);
  });

  it('returns negative inside', () => {
    expect(s.evaluate([0, 0, 0])).toBeLessThan(0);
    expect(s.evaluate([5, 0, 0])).toBeLessThan(0);
  });

  it('returns positive outside', () => {
    expect(s.evaluate([15, 0, 0])).toBeGreaterThan(0);
    expect(s.evaluate([20, 0, 0])).toBeGreaterThan(0);
  });

  it('distance is exact', () => {
    near(s.evaluate([0, 0, 0]), -10);    // center
    near(s.evaluate([20, 0, 0]), 10);    // 20mm from center, r=10
    near(s.evaluate([13, 0, 0]), 3);     // 3mm outside
  });

  it('bounds are exact', () => {
    const b = s.bounds();
    expect(b.min).toEqual([-10, -10, -10]);
    expect(b.max).toEqual([10, 10, 10]);
  });

  it('contains works', () => {
    expect(s.contains([0, 0, 0])).toBe(true);
    expect(s.contains([10, 0, 0])).toBe(true);  // on surface
    expect(s.contains([11, 0, 0])).toBe(false);
  });
});

describe('Box', () => {
  const b = box(100, 60, 30); // centered at origin: ±50, ±30, ±15

  it('returns 0 on face centers', () => {
    near(b.evaluate([50, 0, 0]), 0);   // right face
    near(b.evaluate([0, 30, 0]), 0);   // top face
    near(b.evaluate([0, 0, 15]), 0);   // front face
  });

  it('returns negative inside', () => {
    expect(b.evaluate([0, 0, 0])).toBeLessThan(0);
    near(b.evaluate([0, 0, 0]), -15);  // closest face is ±15 (Z)
  });

  it('returns positive outside', () => {
    expect(b.evaluate([60, 0, 0])).toBeGreaterThan(0);
    near(b.evaluate([60, 0, 0]), 10);  // 10mm past the 50mm face
  });

  it('returns exact distance at corners', () => {
    // Corner at (50, 30, 15): distance = 0
    near(b.evaluate([50, 30, 15]), 0, 0.001);
    // Point diagonally outside
    near(b.evaluate([60, 40, 25]), Math.sqrt(10*10 + 10*10 + 10*10), 0.001);
  });

  it('bounds are exact', () => {
    const bounds = b.bounds();
    expect(bounds.min).toEqual([-50, -30, -15]);
    expect(bounds.max).toEqual([50, 30, 15]);
  });
});

describe('Cylinder', () => {
  const c = cylinder(10, 40); // r=10, h=40, centered: z in [-20, 20]

  it('returns 0 on surface', () => {
    near(c.evaluate([10, 0, 0]), 0);    // on barrel
    near(c.evaluate([5, 0, 20]), 0, 0.01);   // on cap edge area
  });

  it('returns negative inside', () => {
    expect(c.evaluate([0, 0, 0])).toBeLessThan(0);
    expect(c.evaluate([5, 0, 10])).toBeLessThan(0);
  });

  it('returns positive outside', () => {
    expect(c.evaluate([15, 0, 0])).toBeGreaterThan(0);  // radially outside
    expect(c.evaluate([0, 0, 25])).toBeGreaterThan(0);  // above cap
  });

  it('bounds are exact', () => {
    const bounds = c.bounds();
    expect(bounds.min).toEqual([-10, -10, -20]);
    expect(bounds.max).toEqual([10, 10, 20]);
  });
});

describe('Torus', () => {
  const t = torus(20, 5); // major=20, minor=5

  it('returns 0 on surface', () => {
    near(t.evaluate([25, 0, 0]), 0);  // outer edge
    near(t.evaluate([15, 0, 0]), 0);  // inner edge
    near(t.evaluate([20, 0, 5]), 0);  // top
  });

  it('returns negative inside tube', () => {
    expect(t.evaluate([20, 0, 0])).toBeLessThan(0);
    near(t.evaluate([20, 0, 0]), -5);
  });

  it('returns positive at center', () => {
    expect(t.evaluate([0, 0, 0])).toBeGreaterThan(0);
  });
});

describe('Plane', () => {
  const p = plane([0, 0, 1], 10); // z = 10 plane, inside is z < 10

  it('returns 0 on plane', () => {
    near(p.evaluate([0, 0, 10]), 0);
    near(p.evaluate([100, -50, 10]), 0);
  });

  it('returns negative below', () => {
    expect(p.evaluate([0, 0, 5])).toBeLessThan(0);
  });

  it('returns positive above', () => {
    expect(p.evaluate([0, 0, 15])).toBeGreaterThan(0);
  });
});

describe('Cone', () => {
  const c = cone(10, 20); // r=10 at base, h=20, tip at origin

  it('returns negative inside', () => {
    expect(c.evaluate([0, 0, -10])).toBeLessThan(0);
  });

  it('returns positive outside', () => {
    expect(c.evaluate([20, 0, -10])).toBeGreaterThan(0);
  });

  it('returns 0 at tip', () => {
    near(c.evaluate([0, 0, 0]), 0, 0.01);
  });
});
