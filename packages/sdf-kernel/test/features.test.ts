import { describe, it, expect } from 'vitest';
import { box, cylinder, hole, pocket, boltCircle, chamfer, fillet } from '../src/index.js';
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

// ═══════════════════════════════════════════════════════════════
// chamfer() tests
// ═══════════════════════════════════════════════════════════════

describe('chamfer() — basic edge operations', () => {
  const b = box(100, 60, 30); // half-extents: 50, 30, 15

  it('chamfer top.right edge removes material at edge', () => {
    const result = chamfer(b, 'top.right', 5);
    // At the edge (50, 30, 0) — material should be removed (positive SDF)
    expect(result.evaluate([50, 30, 0])).toBeGreaterThan(0);
    // Inside box, away from edge — should still be solid
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('chamfer plane passes through correct tangent points', () => {
    const result = chamfer(b, 'top.right', 5);
    // Chamfer plane tangent point on top face: (50-5, 30, 0) = (45, 30, 0)
    // At that point, dA=0, dB=-5 → cut = (0 + (-5) + 5)/√2 = 0
    expect(Math.abs(result.evaluate([45, 30, 0]))).toBeLessThan(EPSILON);
    // Tangent on right face: (50, 30-5, 0) = (50, 25, 0)
    expect(Math.abs(result.evaluate([50, 25, 0]))).toBeLessThan(EPSILON);
  });

  it('chamfer top.left edge', () => {
    const result = chamfer(b, 'top.left', 3);
    // Edge at (-50, 30, 0)
    expect(result.evaluate([-50, 30, 0])).toBeGreaterThan(0);
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('chamfer bottom.front edge', () => {
    const result = chamfer(b, 'bottom.front', 4);
    // Edge at (0, -30, 15)
    expect(result.evaluate([0, -30, 15])).toBeGreaterThan(0);
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('chamfer front.right edge', () => {
    const result = chamfer(b, 'front.right', 5);
    // Edge at (50, 0, 15)
    expect(result.evaluate([50, 0, 15])).toBeGreaterThan(0);
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });
});

describe('chamfer() — sequential chamfers', () => {
  it('two chamfers on same shape', () => {
    const b = box(100, 60, 30);
    const step1 = chamfer(b, 'top.right', 5);
    const step2 = chamfer(step1, 'top.left', 5);
    // Both edges should be chamfered
    expect(step2.evaluate([50, 30, 0])).toBeGreaterThan(0);
    expect(step2.evaluate([-50, 30, 0])).toBeGreaterThan(0);
    // Center should still be solid
    expect(step2.evaluate([0, 0, 0])).toBeLessThan(0);
  });
});

describe('chamfer() — topology', () => {
  it('removes target edge from edges()', () => {
    const b = box(100, 60, 30);
    const result = chamfer(b, 'top.right', 5);
    const edgeNames = result.edges().map(e => e.name);
    expect(edgeNames).not.toContain('top.right');
    // Other edges should still exist
    expect(edgeNames).toContain('top.left');
    expect(edgeNames).toContain('top.front');
  });

  it('adds new face to faces()', () => {
    const b = box(100, 60, 30);
    const result = chamfer(b, 'top.right', 5);
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('chamfer_1.'))).toBe(true);
  });

  it('new face is freeform kind', () => {
    const b = box(100, 60, 30);
    const result = chamfer(b, 'top.right', 5);
    const breakFace = result.faces().find(f => f.name.startsWith('chamfer_1.'));
    expect(breakFace?.kind).toBe('freeform');
  });
});

describe('chamfer() — feature naming', () => {
  it('auto-names first chamfer as chamfer_1', () => {
    const b = box(100, 60, 30);
    const result = chamfer(b, 'top.right', 5);
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('chamfer_1.'))).toBe(true);
  });

  it('custom feature name', () => {
    const b = box(100, 60, 30);
    const result = chamfer(b, 'top.right', 5, 'bevel');
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('bevel.'))).toBe(true);
  });
});

describe('chamfer() — error handling', () => {
  it('rejects non-existent edge', () => {
    const b = box(100, 60, 30);
    expect(() => chamfer(b, 'top.nonexistent', 5))
      .toThrow(/not found/);
  });

  it('error lists available edges', () => {
    const b = box(100, 60, 30);
    expect(() => chamfer(b, 'fake', 5))
      .toThrow(/top\.right/);
  });

  it('rejects non-planar edge', () => {
    const c = cylinder(20, 40);
    expect(() => chamfer(c, 'top_cap.barrel', 3))
      .toThrow(/planar/);
  });

  it('rejects zero size', () => {
    const b = box(100, 60, 30);
    expect(() => chamfer(b, 'top.right', 0))
      .toThrow(/positive/);
  });

  it('rejects negative size', () => {
    const b = box(100, 60, 30);
    expect(() => chamfer(b, 'top.right', -3))
      .toThrow(/positive/);
  });
});

// ═══════════════════════════════════════════════════════════════
// fillet() tests
// ═══════════════════════════════════════════════════════════════

describe('fillet() — basic edge operations', () => {
  const b = box(100, 60, 30); // half-extents: 50, 30, 15

  it('fillet top.front edge removes material at edge', () => {
    const result = fillet(b, 'top.front', 5);
    // At the edge (0, 30, 15) — material should be removed
    expect(result.evaluate([0, 30, 15])).toBeGreaterThan(0);
    // Inside box, away from edge — should still be solid
    expect(result.evaluate([0, 0, 0])).toBeLessThan(0);
  });

  it('fillet is tangent to both faces at radius distance', () => {
    const result = fillet(b, 'top.right', 5);
    // Tangent point on top face at R from right: (50-5, 30, 0) = (45, 30, 0)
    // dA = 0, dB = -5 → inA=0, inB=5 → cut = 5 - sqrt(0+25) = 0
    expect(Math.abs(result.evaluate([45, 30, 0]))).toBeLessThan(EPSILON);
    // Tangent point on right face at R from top: (50, 30-5, 0) = (50, 25, 0)
    expect(Math.abs(result.evaluate([50, 25, 0]))).toBeLessThan(EPSILON);
  });

  it('fillet distance accuracy — midpoint check', () => {
    const result = fillet(b, 'top.right', 5);
    // At the 45° point: dA = -2.5, dB = -2.5
    const p: Vec3 = [47.5, 27.5, 0];
    const val = result.evaluate(p);
    // Should be positive (material removed in this region)
    expect(val).toBeGreaterThan(0);
    // The fillet cut value should be: 5 - sqrt(2.5^2 + 2.5^2) = 5 - 3.536 ≈ 1.464
    // Box SDF at this point is negative (inside), so result = fillet_cut
    expect(val).toBeCloseTo(5 - Math.sqrt(2 * 2.5 * 2.5), 0.5);
  });
});

describe('fillet() — topology', () => {
  it('removes target edge from edges()', () => {
    const b = box(100, 60, 30);
    const result = fillet(b, 'top.front', 5);
    const edgeNames = result.edges().map(e => e.name);
    expect(edgeNames).not.toContain('top.front');
    expect(edgeNames).toContain('top.right');
  });

  it('adds fillet face', () => {
    const b = box(100, 60, 30);
    const result = fillet(b, 'top.front', 5);
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('fillet_1.'))).toBe(true);
  });
});

describe('fillet() — feature naming', () => {
  it('auto-names first fillet as fillet_1', () => {
    const b = box(100, 60, 30);
    const result = fillet(b, 'top.right', 5);
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('fillet_1.'))).toBe(true);
  });

  it('custom feature name', () => {
    const b = box(100, 60, 30);
    const result = fillet(b, 'top.right', 5, 'round_edge');
    const faceNames = result.faces().map(f => f.name);
    expect(faceNames.some(n => n.startsWith('round_edge.'))).toBe(true);
  });
});

describe('fillet() — error handling', () => {
  it('rejects non-existent edge', () => {
    const b = box(100, 60, 30);
    expect(() => fillet(b, 'top.nonexistent', 5))
      .toThrow(/not found/);
  });

  it('rejects non-planar edge', () => {
    const c = cylinder(20, 40);
    expect(() => fillet(c, 'top_cap.barrel', 3))
      .toThrow(/planar/);
  });

  it('rejects zero radius', () => {
    const b = box(100, 60, 30);
    expect(() => fillet(b, 'top.right', 0))
      .toThrow(/positive/);
  });

  it('error message says fillet(), not chamfer()', () => {
    const c = cylinder(20, 40);
    expect(() => fillet(c, 'top_cap.barrel', 3))
      .toThrow(/fillet\(\)/);
  });
});

// ═══════════════════════════════════════════════════════════════
// chamfer/fillet after boolean subtract
// ═══════════════════════════════════════════════════════════════

describe('chamfer/fillet — after boolean operations', () => {
  it('chamfer on a box after hole subtraction still works on original edges', () => {
    const b = box(100, 60, 30);
    const withHole = hole(b, 'top', { diameter: 10, depth: 'through' });
    // Original box edges still exist
    const result = chamfer(withHole, 'top.right', 3);
    expect(result.evaluate([50, 30, 0])).toBeGreaterThan(0);
    expect(result.evaluate([0, 0, 0])).toBeGreaterThan(0); // hole cavity
  });
});
