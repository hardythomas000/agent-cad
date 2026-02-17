import { describe, it, expect } from 'vitest';
import { box, sphere, cylinder } from '../src/index.js';
import type { Vec3 } from '../src/index.js';

describe('Root finding (findSurface)', () => {
  describe('Sphere ray intersection', () => {
    const s = sphere(10);

    it('finds surface along +X ray', () => {
      const t = s.findSurface([-20, 0, 0], [1, 0, 0], 0, 40);
      expect(t).not.toBeNull();
      // Should hit at t=10 (x goes from -20 to -10 = surface)
      expect(Math.abs(t! - 10)).toBeLessThan(1e-6);
    });

    it('finds surface along -X ray', () => {
      const t = s.findSurface([20, 0, 0], [-1, 0, 0], 0, 40);
      expect(t).not.toBeNull();
      expect(Math.abs(t! - 10)).toBeLessThan(1e-6);
    });

    it('finds surface along diagonal', () => {
      const t = s.findSurface([20, 20, 0], [-1, -1, 0], 0, 40);
      expect(t).not.toBeNull();
      // Ray from (20,20,0) toward origin. Hits sphere at distance 10 from origin.
      // Point at parameter t: (20-t/√2, 20-t/√2, 0)
      // Distance from origin: sqrt(2*(20-t/√2)²) = 10
      // The contact point should be at ~18.28 along the ray
      const p: Vec3 = [20 - t! * Math.SQRT1_2, 20 - t! * Math.SQRT1_2, 0];
      const d = Math.sqrt(p[0] ** 2 + p[1] ** 2);
      expect(Math.abs(d - 10)).toBeLessThan(1e-5);
    });

    it('returns null for miss', () => {
      const t = s.findSurface([0, 20, 0], [1, 0, 0], 0, 40);
      // Ray at y=20, going in +X: misses sphere of r=10
      expect(t).toBeNull();
    });
  });

  describe('Box ray intersection', () => {
    const b = box(100, 60, 30);

    it('finds top face from above', () => {
      const t = b.findSurface([0, 0, 50], [0, 0, -1], 0, 100);
      expect(t).not.toBeNull();
      // Top face at z=15, starting from z=50
      expect(Math.abs(t! - 35)).toBeLessThan(1e-5);
    });
  });

  describe('Drop cutter', () => {
    const b = box(100, 60, 30); // top at z=15

    it('finds top surface from above', () => {
      const t = b.dropCutter(0, 0, 50, -50);
      expect(t).not.toBeNull();
      // From z=50, the surface is at z=15, so t = 50-15 = 35
      expect(Math.abs(t! - 35)).toBeLessThan(1e-5);
    });

    it('finds surface at off-center position', () => {
      const t = b.dropCutter(20, 10, 50, -50);
      expect(t).not.toBeNull();
      expect(Math.abs(t! - 35)).toBeLessThan(1e-5); // still z=15
    });

    it('returns null outside XY footprint', () => {
      const t = b.dropCutter(60, 0, 50, -50);
      // x=60 is outside the box (±50 in X)
      expect(t).toBeNull();
    });
  });

  describe('Precision', () => {
    const s = sphere(100);

    it('achieves sub-micron precision', () => {
      const t = s.findSurface([-200, 0, 0], [1, 0, 0], 0, 400, 1e-7);
      expect(t).not.toBeNull();
      // Surface at x=-100, so t=100 from start at x=-200
      expect(Math.abs(t! - 100)).toBeLessThan(1e-7);

      // Verify: evaluate SDF at the found point
      const hitPoint: Vec3 = [-200 + t!, 0, 0];
      expect(Math.abs(s.evaluate(hitPoint))).toBeLessThan(1e-5);
    });

    it('achieves nanometer precision with tight tolerance', () => {
      const t = s.findSurface([-200, 0, 0], [1, 0, 0], 0, 400, 1e-10);
      expect(t).not.toBeNull();
      expect(Math.abs(t! - 100)).toBeLessThan(1e-10);
    });
  });
});

describe('Gradient / Surface normal', () => {
  describe('Sphere normals', () => {
    const s = sphere(10);

    it('points outward on +X surface', () => {
      const n = s.normal([10, 0, 0]);
      expect(Math.abs(n[0] - 1)).toBeLessThan(1e-4);
      expect(Math.abs(n[1])).toBeLessThan(1e-4);
      expect(Math.abs(n[2])).toBeLessThan(1e-4);
    });

    it('points outward on +Y surface', () => {
      const n = s.normal([0, 10, 0]);
      expect(Math.abs(n[0])).toBeLessThan(1e-4);
      expect(Math.abs(n[1] - 1)).toBeLessThan(1e-4);
      expect(Math.abs(n[2])).toBeLessThan(1e-4);
    });

    it('points diagonal on 45° surface', () => {
      const v = 10 / Math.sqrt(2);
      const n = s.normal([v, v, 0]);
      const expected = 1 / Math.sqrt(2);
      expect(Math.abs(n[0] - expected)).toBeLessThan(1e-3);
      expect(Math.abs(n[1] - expected)).toBeLessThan(1e-3);
    });
  });

  describe('Box normals', () => {
    const b = box(20, 20, 20); // faces at ±10

    it('points +X on right face', () => {
      const n = b.normal([10, 0, 0]);
      expect(n[0]).toBeGreaterThan(0.99);
    });

    it('points +Z on top face', () => {
      const n = b.normal([0, 0, 10]);
      expect(n[2]).toBeGreaterThan(0.99);
    });
  });
});
