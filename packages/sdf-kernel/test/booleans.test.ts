import { describe, it, expect } from 'vitest';
import { box, sphere, cylinder } from '../src/index.js';

const EPSILON = 1e-5;

function near(actual: number, expected: number, tol = EPSILON) {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
}

describe('Union', () => {
  const a = sphere(10);
  const b = sphere(10).translate(15, 0, 0);
  const u = a.union(b);

  it('is min(A, B)', () => {
    // At center of A: inside A, outside B
    const dA = a.evaluate([0, 0, 0]);
    const dB = b.evaluate([0, 0, 0]);
    near(u.evaluate([0, 0, 0]), Math.min(dA, dB));
  });

  it('contains both shapes', () => {
    expect(u.contains([0, 0, 0])).toBe(true);      // inside A
    expect(u.contains([15, 0, 0])).toBe(true);      // inside B
    expect(u.contains([30, 0, 0])).toBe(false);     // outside both
  });
});

describe('Subtract', () => {
  const block = box(40, 40, 40);  // ±20 cube
  const hole = cylinder(5, 50);    // r=5 cylinder through center
  const result = block.subtract(hole);

  it('is max(A, -B)', () => {
    // At origin: inside block, inside cylinder → subtracted
    expect(result.evaluate([0, 0, 0])).toBeGreaterThan(0);
  });

  it('removes material', () => {
    expect(result.contains([0, 0, 0])).toBe(false);     // on cylinder axis
    expect(result.contains([15, 0, 0])).toBe(true);     // inside block, outside cylinder
    expect(result.contains([3, 0, 0])).toBe(false);     // inside cylinder
    expect(result.contains([6, 0, 0])).toBe(true);      // outside cylinder, inside block
  });
});

describe('Intersect', () => {
  const a = sphere(10);
  const b = sphere(10).translate(8, 0, 0);
  const inter = a.intersect(b);

  it('is max(A, B)', () => {
    const dA = a.evaluate([4, 0, 0]);
    const dB = b.evaluate([4, 0, 0]);
    near(inter.evaluate([4, 0, 0]), Math.max(dA, dB));
  });

  it('only contains the overlap region', () => {
    expect(inter.contains([4, 0, 0])).toBe(true);       // in overlap
    // Origin: dA=-10, dB=sqrt(64)-10=-2 → max=-2 → inside intersection (both spheres overlap here)
    expect(inter.contains([0, 0, 0])).toBe(true);
    // x=-5: dA=-5, dB=sqrt(169)-10=3 → max=3 → outside (not in B)
    expect(inter.contains([-5, 0, 0])).toBe(false);
    // x=13: dA=3, dB=-5 → max=3 → outside (not in A)
    expect(inter.contains([13, 0, 0])).toBe(false);
  });
});

describe('Smooth Union', () => {
  const a = sphere(10);
  const b = sphere(10).translate(15, 0, 0);

  it('blends more than sharp union', () => {
    const sharp = a.union(b);
    const smooth = a.smoothUnion(b, 5);
    // Smooth union should be smaller (more negative/less positive) at the blend zone
    const mid = [7.5, 0, 0] as [number, number, number];
    expect(smooth.evaluate(mid)).toBeLessThan(sharp.evaluate(mid));
  });

  it('approaches sharp union far from blend', () => {
    const sharp = a.union(b);
    const smooth = a.smoothUnion(b, 2);
    // Far from the junction, smooth ≈ sharp
    near(smooth.evaluate([0, 0, 0]), sharp.evaluate([0, 0, 0]), 0.01);
  });
});

describe('Smooth Subtract (fillet)', () => {
  const block = box(40, 40, 40);
  const hole = cylinder(5, 50);

  it('creates a blend at the cut edge', () => {
    const sharp = block.subtract(hole);
    const smooth = block.smoothSubtract(hole, 3);
    // At the edge where cylinder meets block face, smooth should differ
    const edgePoint: [number, number, number] = [5, 0, 20];
    const dSharp = sharp.evaluate(edgePoint);
    const dSmooth = smooth.evaluate(edgePoint);
    // They should differ near the edge
    expect(dSharp).not.toBe(dSmooth);
  });
});

describe('Chained operations', () => {
  it('supports fluent chaining', () => {
    const part = box(100, 60, 30)
      .subtract(cylinder(5, 40).translate(25, 15, 0))
      .subtract(cylinder(5, 40).translate(-25, -15, 0))
      .union(sphere(8).translate(0, 0, 20));

    // Block center should be inside
    expect(part.contains([0, 0, 0])).toBe(true);
    // Hole centers should be empty
    expect(part.contains([25, 15, 0])).toBe(false);
    expect(part.contains([-25, -15, 0])).toBe(false);
    // Sphere on top should be inside
    expect(part.contains([0, 0, 20])).toBe(true);
  });

  it('readback returns structured data', () => {
    const part = box(100, 60, 30);
    const rb = part.readback();
    expect(rb.name).toBe('box(100, 60, 30)');
    expect(rb.size[0]).toBeCloseTo(100, 0);
    expect(rb.size[1]).toBeCloseTo(60, 0);
    expect(rb.size[2]).toBeCloseTo(30, 0);
    expect(rb.center).toEqual([0, 0, 0]);
  });
});
