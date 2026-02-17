import { describe, it, expect } from 'vitest';
import { box, sphere, cylinder } from '../src/index.js';
import type { Vec3 } from '../src/index.js';

const EPSILON = 1e-4;

function near(actual: number, expected: number, tol = EPSILON) {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
}

describe('Translate', () => {
  const s = sphere(10).translate(20, 0, 0);

  it('moves the shape', () => {
    near(s.evaluate([20, 0, 0]), -10);   // center at (20,0,0)
    near(s.evaluate([30, 0, 0]), 0);      // surface at x=30
    expect(s.contains([0, 0, 0])).toBe(false);  // origin is now outside
  });

  it('.at() is alias for translate', () => {
    const s2 = sphere(10).at(20, 0, 0);
    near(s2.evaluate([20, 0, 0]), -10);
  });

  it('bounds shift correctly', () => {
    const b = s.bounds();
    near(b.min[0], 10);
    near(b.max[0], 30);
  });
});

describe('RotateZ', () => {
  const b = box(20, 10, 10).rotateZ(90); // 90° around Z

  it('swaps X and Y', () => {
    // Original box: ±10 in X, ±5 in Y
    // After 90° Z rotation: ±5 in X, ±10 in Y
    expect(b.contains([0, 0, 0])).toBe(true);
    expect(b.contains([4, 0, 0])).toBe(true);    // was Y, now fits in ±5
    expect(b.contains([8, 0, 0])).toBe(false);   // exceeds new ±5 in X
    expect(b.contains([0, 8, 0])).toBe(true);    // was X, now fits in ±10
  });
});

describe('RotateX', () => {
  const c = cylinder(5, 20).rotateX(90); // cylinder now along Y

  it('rotates cylinder to Y axis', () => {
    expect(c.contains([0, 0, 0])).toBe(true);
    expect(c.contains([0, 8, 0])).toBe(true);    // along Y
    expect(c.contains([0, 0, 8])).toBe(false);   // no longer along Z
  });
});

describe('Scale', () => {
  const s = sphere(10).scale(2);

  it('doubles the size', () => {
    near(s.evaluate([0, 0, 0]), -20);    // center distance = -2*10
    near(s.evaluate([20, 0, 0]), 0);     // surface at 20
    expect(s.contains([15, 0, 0])).toBe(true);
    expect(s.contains([25, 0, 0])).toBe(false);
  });

  it('bounds scale correctly', () => {
    const b = s.bounds();
    near(b.min[0], -20);
    near(b.max[0], 20);
  });
});

describe('Mirror', () => {
  const s = sphere(5).translate(20, 0, 0).mirror('x');

  it('creates symmetry', () => {
    expect(s.contains([20, 0, 0])).toBe(true);
    expect(s.contains([-20, 0, 0])).toBe(true);   // mirrored
    expect(s.contains([0, 0, 0])).toBe(false);
  });
});

describe('Shell', () => {
  const s = sphere(10).shell(1); // 1mm thick shell

  it('is hollow', () => {
    expect(s.contains([0, 0, 0])).toBe(false);    // center is hollow
    expect(s.contains([10, 0, 0])).toBe(true);    // on original surface (within shell)
    expect(s.contains([9.7, 0, 0])).toBe(true);   // inside the shell wall
    expect(s.contains([8, 0, 0])).toBe(false);    // too far inside
  });
});

describe('Round', () => {
  const b = box(20, 20, 20).round(2); // rounded box

  it('rounds the edges', () => {
    // round(r) subtracts r from SDF, expanding the shape outward by r.
    // Original face at x=10, now at x=12. Original corner at (10,10,10) is now inside.
    expect(b.contains([10, 10, 10])).toBe(true);    // within the expanded shape
    expect(b.contains([9, 9, 9])).toBe(true);
    // Face centers move outward by r
    near(b.evaluate([12, 0, 0]), 0, 0.1);           // new face at x=12
    expect(b.contains([13, 0, 0])).toBe(false);     // past the new face
    // Sharp corner is now rounded — point at exactly (12,12,12) is outside the rounded corner
    expect(b.contains([12, 12, 12])).toBe(false);
  });
});

describe('Elongate', () => {
  const s = sphere(10).elongate(20, 0, 0); // stretch sphere 20mm in X

  it('extends shape along the axis', () => {
    expect(s.contains([0, 0, 0])).toBe(true);
    expect(s.contains([15, 0, 0])).toBe(true);      // inside elongated region
    expect(s.contains([0, 0, 8])).toBe(true);
    expect(s.contains([25, 0, 0])).toBe(false);
  });

  it('preserves cross-section in Z', () => {
    // At center, cross-section is still a sphere of r=10
    near(s.evaluate([0, 0, 10]), 0);
    // Within elongation range, Z cross-section remains r=10
    near(s.evaluate([5, 0, 10]), 0);
  });

  it('returns correct SDF at center', () => {
    near(s.evaluate([0, 0, 0]), -10);
  });

  it('is positive outside', () => {
    expect(s.evaluate([0, 0, 15])).toBeGreaterThan(0);
  });
});

describe('Scale guards', () => {
  it('throws on zero scale', () => {
    expect(() => sphere(10).scale(0)).toThrow('Scale factor cannot be zero');
  });

  it('throws on negative scale', () => {
    expect(() => sphere(10).scale(-1)).toThrow('Scale factor must be positive');
  });
});

describe('Compound transforms', () => {
  it('translate then rotate', () => {
    const part = sphere(5).translate(20, 0, 0).rotateZ(90);
    // Sphere at (20,0,0), rotated 90° around Z → now at (0,20,0)
    expect(part.contains([0, 20, 0])).toBe(true);
    expect(part.contains([20, 0, 0])).toBe(false);
  });
});
