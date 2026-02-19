import { describe, it, expect } from 'vitest';
import { extractContours } from '../src/marching-squares.js';

// ─── Circle SDF ─────────────────────────────────────────────────
// f(x,z) = sqrt(x^2 + z^2) - R → circle of radius R centered at origin

describe('extractContours — circle SDF', () => {
  const R = 20;
  const circleSdf = (x: number, z: number) => Math.sqrt(x * x + z * z) - R;

  it('produces a single closed loop', () => {
    const loops = extractContours(circleSdf, { xMin: -30, xMax: 30, zMin: -30, zMax: 30 }, 2.0);
    expect(loops.length).toBe(1);
    expect(loops[0].closed).toBe(true);
  });

  it('loop points lie on the circle (within cell size tolerance)', () => {
    const cellSize = 1.0;
    const loops = extractContours(circleSdf, { xMin: -30, xMax: 30, zMin: -30, zMax: 30 }, cellSize);
    expect(loops.length).toBe(1);
    for (const [x, z] of loops[0].points) {
      const dist = Math.sqrt(x * x + z * z);
      expect(Math.abs(dist - R)).toBeLessThan(cellSize); // Within one cell size
    }
  });

  it('finer resolution produces more points', () => {
    const coarse = extractContours(circleSdf, { xMin: -30, xMax: 30, zMin: -30, zMax: 30 }, 4.0);
    const fine = extractContours(circleSdf, { xMin: -30, xMax: 30, zMin: -30, zMax: 30 }, 1.0);
    expect(fine[0].points.length).toBeGreaterThan(coarse[0].points.length);
  });
});

// ─── Box SDF (2D) ───────────────────────────────────────────────
// f(x,z) = max(|x| - hw, |z| - hd)

describe('extractContours — box SDF', () => {
  const hw = 25; // half-width
  const hd = 15; // half-depth
  const boxSdf = (x: number, z: number) => Math.max(Math.abs(x) - hw, Math.abs(z) - hd);

  it('produces a single closed loop', () => {
    const loops = extractContours(boxSdf, { xMin: -40, xMax: 40, zMin: -30, zMax: 30 }, 2.0);
    expect(loops.length).toBe(1);
    expect(loops[0].closed).toBe(true);
  });

  it('loop has at least 4 points (rectangular shape)', () => {
    const loops = extractContours(boxSdf, { xMin: -40, xMax: 40, zMin: -30, zMax: 30 }, 2.0);
    expect(loops[0].points.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── Box with hole → 2 loops ───────────────────────────────────

describe('extractContours — box with hole', () => {
  const hw = 25;
  const hd = 15;
  const holeR = 8;
  // Box minus circle: max(box, -circle)
  const sdf = (x: number, z: number) => {
    const boxVal = Math.max(Math.abs(x) - hw, Math.abs(z) - hd);
    const holeVal = Math.sqrt(x * x + z * z) - holeR;
    return Math.max(boxVal, -holeVal);
  };

  it('produces multiple loops (outer + inner)', () => {
    const loops = extractContours(sdf, { xMin: -40, xMax: 40, zMin: -30, zMax: 30 }, 1.0);
    expect(loops.length).toBeGreaterThanOrEqual(2);
    // At least 2 loops should be closed
    const closedLoops = loops.filter(l => l.closed);
    expect(closedLoops.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Empty region ───────────────────────────────────────────────

describe('extractContours — empty region', () => {
  it('returns no loops when entirely outside (positive SDF)', () => {
    const alwaysPositive = () => 10.0;
    const loops = extractContours(alwaysPositive, { xMin: -10, xMax: 10, zMin: -10, zMax: 10 }, 2.0);
    expect(loops.length).toBe(0);
  });

  it('returns no loops when entirely inside (negative SDF)', () => {
    const alwaysNegative = () => -10.0;
    const loops = extractContours(alwaysNegative, { xMin: -10, xMax: 10, zMin: -10, zMax: 10 }, 2.0);
    expect(loops.length).toBe(0);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────

describe('extractContours — edge cases', () => {
  it('throws on zero cellSize', () => {
    expect(() => extractContours(() => 0, { xMin: 0, xMax: 10, zMin: 0, zMax: 10 }, 0))
      .toThrow(/positive/);
  });

  it('throws on negative cellSize', () => {
    expect(() => extractContours(() => 0, { xMin: 0, xMax: 10, zMin: 0, zMax: 10 }, -1))
      .toThrow(/positive/);
  });
});
