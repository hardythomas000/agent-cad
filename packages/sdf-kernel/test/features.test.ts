import { describe, it, expect } from 'vitest';
import { box, cylinder, hole, pocket, boltCircle } from '../src/index.js';
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

  it('rejects zero diameter', () => {
    const b = box(100, 60, 30);
    expect(() => hole(b, 'top', { diameter: 0, depth: 10 }))
      .toThrow(/diameter/);
  });
});

// ═══════════════════════════════════════════════════════════════
// pocket() tests
// ═══════════════════════════════════════════════════════════════

describe('pocket() — centered on various faces', () => {
  const b = box(100, 60, 30); // half-extents: 50, 30, 15

  it('top face — centered pocket removes material', () => {
    const result = pocket(b, 'top', { width: 40, length: 20, depth: 10 });
    // Center near top should be inside pocket (positive — material removed)
    expect(result.evaluate([0, 25, 0])).toBeGreaterThan(0);
    // Center of box should still be solid (below pocket)
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('front face — centered pocket', () => {
    const result = pocket(b, 'front', { width: 40, length: 20, depth: 10 });
    // Near front face center (z=15), pocket goes inward
    expect(result.evaluate([0, 0, 10])).toBeGreaterThan(0);
    // Origin should be solid (away from front face)
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('right face — centered pocket', () => {
    const result = pocket(b, 'right', { width: 20, length: 20, depth: 10 });
    // Near right face (x=50), pocket goes inward
    expect(result.evaluate([45, 0, 0])).toBeGreaterThan(0);
    // Origin should be solid
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });
});

describe('pocket() — offset from center', () => {
  const b = box(100, 60, 30);

  it('offset pocket on top face', () => {
    const result = pocket(b, 'top', { width: 20, length: 20, depth: 10, at: [20, 0, 0] });
    // Offset center near top should be inside pocket
    expect(result.evaluate([20, 25, 0])).toBeGreaterThan(0);
    // Original center near top should be solid (no pocket there)
    expect(result.evaluate([0, 25, 0])).toBeLessThan(0);
  });
});

describe('pocket() — feature naming', () => {
  const b = box(100, 60, 30);

  it('auto-names first pocket as pocket_1', () => {
    const result = pocket(b, 'top', { width: 40, length: 20, depth: 10 });
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('pocket_1.'))).toBe(true);
  });

  it('auto-names second pocket as pocket_2', () => {
    const step1 = pocket(b, 'top', { width: 40, length: 20, depth: 10 });
    const step2 = pocket(step1, 'top', { width: 20, length: 10, depth: 5, at: [30, 0, 0] });
    const faceNames = step2.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('pocket_1.'))).toBe(true);
    expect(faceNames.some(n => n.startsWith('pocket_2.'))).toBe(true);
  });

  it('custom feature name', () => {
    const result = pocket(b, 'top', { width: 40, length: 20, depth: 10, featureName: 'recess' });
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('recess.'))).toBe(true);
  });
});

describe('pocket() — error handling', () => {
  it('rejects non-planar face', () => {
    const s = cylinder(20, 40);
    expect(() => pocket(s, 'barrel', { width: 10, length: 10, depth: 5 }))
      .toThrow(/planar/);
  });

  it('rejects zero depth', () => {
    const b = box(100, 60, 30);
    expect(() => pocket(b, 'top', { width: 40, length: 20, depth: 0 }))
      .toThrow(/positive/);
  });

  it('rejects negative depth', () => {
    const b = box(100, 60, 30);
    expect(() => pocket(b, 'top', { width: 40, length: 20, depth: -5 }))
      .toThrow(/positive/);
  });

  it('error message says pocket(), not hole()', () => {
    const s = cylinder(20, 40);
    expect(() => pocket(s, 'barrel', { width: 10, length: 10, depth: 5 }))
      .toThrow(/pocket\(\)/);
  });

  it('rejects zero width', () => {
    const b = box(100, 60, 30);
    expect(() => pocket(b, 'top', { width: 0, length: 20, depth: 10 }))
      .toThrow(/width/);
  });

  it('rejects zero length', () => {
    const b = box(100, 60, 30);
    expect(() => pocket(b, 'top', { width: 40, length: 0, depth: 10 }))
      .toThrow(/length/);
  });

  it('rejects string depth (through)', () => {
    const b = box(100, 60, 30);
    expect(() => pocket(b, 'top', { width: 40, length: 20, depth: 'through' as any }))
      .toThrow(/number/);
  });
});

// ═══════════════════════════════════════════════════════════════
// boltCircle() tests
// ═══════════════════════════════════════════════════════════════

describe('boltCircle() — basic pattern', () => {
  const b = box(100, 60, 30);

  it('4-hole bolt circle creates holes at correct positions', () => {
    const result = boltCircle(b, 'top', {
      count: 4,
      boltCircleDiameter: 40,
      holeDiameter: 6,
      depth: 'through',
    });
    // Holes at ±20 on X and Z axes (BCD=40, r=20)
    // Top face normal is +Y, so U=X, V=Z
    expect(result.evaluate([20, 0, 0])).toBeGreaterThan(0);  // hole at 0°
    expect(result.evaluate([0, 0, 20])).toBeGreaterThan(0);   // hole at 90°
    expect(result.evaluate([-20, 0, 0])).toBeGreaterThan(0);  // hole at 180°
    expect(result.evaluate([0, 0, -20])).toBeGreaterThan(0);  // hole at 270°
    // Center should be solid (no hole there)
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('through-holes penetrate fully', () => {
    const result = boltCircle(b, 'top', {
      count: 1,
      boltCircleDiameter: 40,
      holeDiameter: 6,
      depth: 'through',
    });
    // Single hole at (20, 0, 0) — check at bottom of box
    expect(result.evaluate([20, -25, 0])).toBeGreaterThan(0);
  });
});

describe('boltCircle() — start angle', () => {
  const b = box(100, 60, 30);

  it('start angle rotates pattern', () => {
    const result = boltCircle(b, 'top', {
      count: 4,
      boltCircleDiameter: 40,
      holeDiameter: 6,
      depth: 'through',
      startAngle: 45,
    });
    // At 45° start, holes at 45°, 135°, 225°, 315°
    // cos(45°)*20 ≈ 14.14, sin(45°)*20 ≈ 14.14
    const d = 20 * Math.cos(Math.PI / 4); // ~14.14
    expect(result.evaluate([d, 0, d])).toBeGreaterThan(0);   // hole at 45°
    expect(result.evaluate([-d, 0, d])).toBeGreaterThan(0);  // hole at 135°
  });
});

describe('boltCircle() — offset center', () => {
  const b = box(100, 60, 30);

  it('at shifts entire bolt circle', () => {
    const result = boltCircle(b, 'top', {
      count: 1,
      boltCircleDiameter: 20,
      holeDiameter: 6,
      depth: 'through',
      at: [15, 0, 0],
    });
    // Single hole, BCD=20 so r=10, offset by at=[15,0,0]
    // Hole at (15+10, 0, 0) = (25, 0, 0)
    expect(result.evaluate([25, 0, 0])).toBeGreaterThan(0);
    // Original center should be solid
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });
});

describe('boltCircle() — feature naming', () => {
  const b = box(100, 60, 30);

  it('auto-names holes as hole_1..hole_N', () => {
    const result = boltCircle(b, 'top', {
      count: 4,
      boltCircleDiameter: 40,
      holeDiameter: 6,
      depth: 'through',
    });
    const faceNames = result.faces().map(f => f.name);
    // Should have hole_1 through hole_4
    for (let i = 1; i <= 4; i++) {
      expect(faceNames.some(n => n.startsWith(`hole_${i}.`))).toBe(true);
    }
  });

  it('custom feature prefix names holes', () => {
    const result = boltCircle(b, 'top', {
      count: 3,
      boltCircleDiameter: 40,
      holeDiameter: 6,
      depth: 'through',
      featureName: 'mount',
    });
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('mount_1.'))).toBe(true);
    expect(faceNames.some(n => n.startsWith('mount_2.'))).toBe(true);
    expect(faceNames.some(n => n.startsWith('mount_3.'))).toBe(true);
  });
});

describe('boltCircle() — error handling', () => {
  it('rejects count < 1', () => {
    const b = box(100, 60, 30);
    expect(() => boltCircle(b, 'top', {
      count: 0,
      boltCircleDiameter: 40,
      holeDiameter: 6,
      depth: 'through',
    })).toThrow(/count/);
  });

  it('rejects non-positive diameter', () => {
    const b = box(100, 60, 30);
    expect(() => boltCircle(b, 'top', {
      count: 4,
      boltCircleDiameter: 0,
      holeDiameter: 6,
      depth: 'through',
    })).toThrow(/boltCircleDiameter/);
  });

  it('rejects non-planar face', () => {
    const s = cylinder(20, 40);
    expect(() => boltCircle(s, 'barrel', {
      count: 4,
      boltCircleDiameter: 30,
      holeDiameter: 5,
      depth: 'through',
    })).toThrow(/planar/);
  });
});

// ═══════════════════════════════════════════════════════════════
// nextFeatureName bug fix verification
// ═══════════════════════════════════════════════════════════════

describe('nextFeatureName — non-sequential numbering', () => {
  it('handles gap in numbering (hole_1, hole_3 → next is hole_4)', () => {
    const b = box(100, 60, 30);
    const step1 = hole(b, 'top', { diameter: 6, depth: 'through' });               // hole_1
    const step2 = hole(step1, 'top', { diameter: 6, depth: 'through', at: [20, 0, 0], featureName: 'hole_3' }); // hole_3 (manual)
    const step3 = hole(step2, 'top', { diameter: 6, depth: 'through', at: [-20, 0, 0] }); // should be hole_4 (not hole_3!)
    const faceNames = step3.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('hole_4.'))).toBe(true);
  });
});
