import { describe, it, expect } from 'vitest';
import { box, cylinder, hole } from '../src/index.js';
import type { Vec3 } from '../src/index.js';

const EPSILON = 0.5; // SDF tolerance for marching cubes grid alignment

// ─── hole() on all 6 box faces ──────────────────────────────────

describe('hole() — through-hole on each box face', () => {
  const b = box(100, 60, 30); // half-extents: 50, 30, 15

  it('top face — centered through-hole', () => {
    const result = hole(b, 'top', { diameter: 10, depth: 'through' });
    // Point at origin is inside the hole cavity — SDF positive (material removed)
    expect(result.evaluate([0, 0, 0])).toBeGreaterThan(0);
    // Point on the surface at hole radius along X should be near zero
    expect(Math.abs(result.evaluate([5, 0, 0]))).toBeLessThan(EPSILON);
    // Point outside hole radius but inside box should still be negative (solid)
    expect(result.evaluate([10, 0, 0])).toBeLessThan(0);
  });

  it('bottom face — centered through-hole', () => {
    const result = hole(b, 'bottom', { diameter: 10, depth: 'through' });
    expect(result.evaluate([0, 0, 0])).toBeGreaterThan(0);
    expect(Math.abs(result.evaluate([5, 0, 0]))).toBeLessThan(EPSILON);
  });

  it('front face — centered through-hole', () => {
    const result = hole(b, 'front', { diameter: 10, depth: 'through' });
    // Front face normal is +Z, hole goes through Z axis
    expect(result.evaluate([0, 0, 0])).toBeGreaterThan(0);
    expect(Math.abs(result.evaluate([5, 0, 0]))).toBeLessThan(EPSILON);
  });

  it('back face — centered through-hole', () => {
    const result = hole(b, 'back', { diameter: 10, depth: 'through' });
    expect(result.evaluate([0, 0, 0])).toBeGreaterThan(0);
  });

  it('left face — centered through-hole', () => {
    const result = hole(b, 'left', { diameter: 10, depth: 'through' });
    expect(result.evaluate([0, 0, 0])).toBeGreaterThan(0);
  });

  it('right face — centered through-hole', () => {
    const result = hole(b, 'right', { diameter: 10, depth: 'through' });
    expect(result.evaluate([0, 0, 0])).toBeGreaterThan(0);
  });
});

// ─── Blind hole ─────────────────────────────────────────────────

describe('hole() — blind hole', () => {
  const b = box(100, 60, 30);

  it('blind hole with explicit depth on top face', () => {
    const result = hole(b, 'top', { diameter: 10, depth: 10 });
    // Inside the blind hole near the top — positive (material removed)
    expect(result.evaluate([0, 25, 0])).toBeGreaterThan(0);
    // Below the blind hole depth — should be solid (inside box, below hole)
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });
});

// ─── Offset hole ────────────────────────────────────────────────

describe('hole() — offset from center', () => {
  const b = box(100, 60, 30);

  it('offset hole on top face using 3D at', () => {
    const result = hole(b, 'top', { diameter: 10, depth: 'through', at: [30, 0, 0] });
    // Hole center at (30, 0, 0) — inside hole cavity (positive)
    expect(result.evaluate([30, 0, 0])).toBeGreaterThan(0);
    // At the hole radius edge
    expect(Math.abs(result.evaluate([35, 0, 0]))).toBeLessThan(EPSILON);
    // Original center should be solid (no hole there)
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('offset hole with normal component dropped', () => {
    // at: [30, 999, 10] — Y component should be dropped for top face (normal Y)
    const result = hole(b, 'top', { diameter: 10, depth: 'through', at: [30, 999, 10] });
    // Hole should be at (30, *, 10) regardless of the Y=999 — inside hole (positive)
    expect(result.evaluate([30, 0, 10])).toBeGreaterThan(0);
  });
});

// ─── Feature naming ─────────────────────────────────────────────

describe('hole() — feature naming', () => {
  const b = box(100, 60, 30);

  it('auto-names first hole as hole_1', () => {
    const result = hole(b, 'top', { diameter: 10, depth: 'through' });
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('hole_1.'))).toBe(true);
  });

  it('auto-names second hole as hole_2', () => {
    const step1 = hole(b, 'top', { diameter: 10, depth: 'through' });
    const step2 = hole(step1, 'top', { diameter: 8, depth: 'through', at: [30, 0, 0] });
    const faceNames = step2.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('hole_1.'))).toBe(true);
    expect(faceNames.some(n => n.startsWith('hole_2.'))).toBe(true);
  });

  it('custom feature name', () => {
    const result = hole(b, 'top', { diameter: 10, depth: 'through', featureName: 'drain' });
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('drain.'))).toBe(true);
  });

  it('barrel face accessible after hole', () => {
    const result = hole(b, 'top', { diameter: 10, depth: 'through' });
    const barrel = result.face('hole_1.barrel');
    expect(barrel.kind).toBe('cylindrical');
    expect(barrel.radius).toBeCloseTo(5, 1);
  });
});

// ─── Error cases ────────────────────────────────────────────────

describe('hole() — error handling', () => {
  it('rejects non-planar face', () => {
    const s = cylinder(20, 40);
    expect(() => hole(s, 'barrel', { diameter: 5, depth: 10 }))
      .toThrow(/planar/);
  });

  it('rejects non-existent face', () => {
    const b = box(100, 60, 30);
    expect(() => hole(b, 'lateral', { diameter: 5, depth: 10 }))
      .toThrow(/not found/);
  });

  it('rejects zero depth', () => {
    const b = box(100, 60, 30);
    expect(() => hole(b, 'top', { diameter: 10, depth: 0 }))
      .toThrow(/positive/);
  });

  it('rejects negative depth', () => {
    const b = box(100, 60, 30);
    expect(() => hole(b, 'top', { diameter: 10, depth: -5 }))
      .toThrow(/positive/);
  });
});
