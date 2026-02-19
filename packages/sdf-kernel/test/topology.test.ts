import { describe, it, expect } from 'vitest';
import {
  box, sphere, cylinder, cone, torus, plane,
  circle2d, rect2d, polygon, extrude, revolve,
} from '../src/index.js';
import type { Vec3 } from '../src/index.js';
import type { FaceDescriptor, EdgeDescriptor } from '../src/topology.js';

// ─── Helpers ──────────────────────────────────────────────────

function faceNames(shape: { faces(): FaceDescriptor[] }): string[] {
  return shape.faces().map(f => f.name).sort();
}

function hasFace(shape: { faces(): FaceDescriptor[] }, name: string): boolean {
  return shape.faces().some(f => f.name === name);
}

function getFace(shape: { faces(): FaceDescriptor[] }, name: string): FaceDescriptor {
  const f = shape.faces().find(f => f.name === name);
  if (!f) throw new Error(`Face "${name}" not found. Available: ${faceNames(shape).join(', ')}`);
  return f;
}

const EPSILON = 1e-5;

function nearVec3(actual: Vec3, expected: Vec3, tol = EPSILON) {
  expect(Math.abs(actual[0] - expected[0])).toBeLessThan(tol);
  expect(Math.abs(actual[1] - expected[1])).toBeLessThan(tol);
  expect(Math.abs(actual[2] - expected[2])).toBeLessThan(tol);
}

// ─── Primitive Face Tables ────────────────────────────────────

describe('Box topology', () => {
  const b = box(100, 60, 30);

  it('has 6 faces', () => {
    expect(b.faces()).toHaveLength(6);
  });

  it('has correct face names', () => {
    expect(faceNames(b)).toEqual(['back', 'bottom', 'front', 'left', 'right', 'top']);
  });

  it('all faces are planar', () => {
    for (const f of b.faces()) {
      expect(f.kind).toBe('planar');
    }
  });

  it('top face has correct normal and origin', () => {
    const top = getFace(b, 'top');
    nearVec3(top.normal, [0, 1, 0]);
    expect(top.origin).toBeDefined();
    expect(top.origin![1]).toBeCloseTo(30); // half of 60
  });

  it('right face has correct normal and origin', () => {
    const right = getFace(b, 'right');
    nearVec3(right.normal, [1, 0, 0]);
    expect(right.origin![0]).toBeCloseTo(50); // half of 100
  });

  it('has 12 edges', () => {
    expect(b.edges()).toHaveLength(12);
  });

  it('edges are all line type', () => {
    for (const e of b.edges()) {
      expect(e.kind).toBe('line');
    }
  });

  it('classifyPoint identifies top face', () => {
    expect(b.classifyPoint([0, 30, 0])).toBe('top');
  });

  it('classifyPoint identifies bottom face', () => {
    expect(b.classifyPoint([0, -30, 0])).toBe('bottom');
  });

  it('classifyPoint identifies right face', () => {
    expect(b.classifyPoint([50, 0, 0])).toBe('right');
  });

  it('classifyPoint identifies front face', () => {
    expect(b.classifyPoint([0, 0, 15])).toBe('front');
  });

  it('face() lookup works', () => {
    const f = b.face('top');
    expect(f.name).toBe('top');
    expect(f.kind).toBe('planar');
  });

  it('face() throws for unknown name', () => {
    expect(() => b.face('nonexistent')).toThrow(/not found/i);
  });
});

describe('Sphere topology', () => {
  const s = sphere(10);

  it('has 1 face named surface', () => {
    expect(s.faces()).toHaveLength(1);
    expect(s.faces()[0].name).toBe('surface');
  });

  it('surface is spherical', () => {
    expect(s.faces()[0].kind).toBe('spherical');
    expect(s.faces()[0].radius).toBe(10);
  });

  it('has 0 edges', () => {
    expect(s.edges()).toHaveLength(0);
  });

  it('classifyPoint always returns surface', () => {
    expect(s.classifyPoint([10, 0, 0])).toBe('surface');
    expect(s.classifyPoint([0, 10, 0])).toBe('surface');
  });
});

describe('Cylinder topology', () => {
  const c = cylinder(5, 40);

  it('has 3 faces', () => {
    expect(c.faces()).toHaveLength(3);
  });

  it('has correct face names', () => {
    expect(faceNames(c)).toEqual(['barrel', 'bottom_cap', 'top_cap']);
  });

  it('barrel is cylindrical with correct radius', () => {
    const barrel = getFace(c, 'barrel');
    expect(barrel.kind).toBe('cylindrical');
    expect(barrel.radius).toBe(5);
  });

  it('caps are planar', () => {
    expect(getFace(c, 'top_cap').kind).toBe('planar');
    expect(getFace(c, 'bottom_cap').kind).toBe('planar');
  });

  it('has 2 arc edges', () => {
    expect(c.edges()).toHaveLength(2);
    for (const e of c.edges()) {
      expect(e.kind).toBe('arc');
    }
  });

  it('classifyPoint identifies barrel', () => {
    expect(c.classifyPoint([5, 0, 0])).toBe('barrel');
  });

  it('classifyPoint identifies top cap', () => {
    expect(c.classifyPoint([0, 0, 20])).toBe('top_cap');
  });
});

describe('Cone topology', () => {
  const c = cone(10, 30);

  it('has 2 faces', () => {
    expect(c.faces()).toHaveLength(2);
  });

  it('has correct face names', () => {
    expect(faceNames(c)).toEqual(['base_cap', 'surface']);
  });

  it('base_cap is planar', () => {
    expect(getFace(c, 'base_cap').kind).toBe('planar');
  });

  it('surface is conical', () => {
    expect(getFace(c, 'surface').kind).toBe('conical');
  });

  it('has 1 arc edge', () => {
    expect(c.edges()).toHaveLength(1);
    expect(c.edges()[0].kind).toBe('arc');
  });
});

describe('Torus topology', () => {
  const t = torus(20, 5);

  it('has 1 face named surface', () => {
    expect(t.faces()).toHaveLength(1);
    expect(t.faces()[0].name).toBe('surface');
    expect(t.faces()[0].kind).toBe('toroidal');
  });

  it('has 0 edges', () => {
    expect(t.edges()).toHaveLength(0);
  });

  it('classifyPoint always returns surface', () => {
    expect(t.classifyPoint([20, 0, 0])).toBe('surface');
  });
});

describe('Plane topology', () => {
  const p = plane([0, 1, 0], 10);

  it('has 1 face named surface', () => {
    expect(p.faces()).toHaveLength(1);
    expect(p.faces()[0].name).toBe('surface');
    expect(p.faces()[0].kind).toBe('planar');
  });

  it('classifyPoint always returns surface', () => {
    expect(p.classifyPoint([0, 10, 0])).toBe('surface');
  });
});

// ─── Transform Propagation ────────────────────────────────────

describe('Translate topology', () => {
  const b = box(100, 60, 30).translate(10, 20, 30);

  it('preserves face count', () => {
    expect(b.faces()).toHaveLength(6);
  });

  it('shifts origin of top face', () => {
    const top = getFace(b, 'top');
    // Original top origin is [0, 30, 0], shifted by [10, 20, 30]
    expect(top.origin![0]).toBeCloseTo(10);
    expect(top.origin![1]).toBeCloseTo(50);
    expect(top.origin![2]).toBeCloseTo(30);
  });

  it('preserves face normals', () => {
    nearVec3(getFace(b, 'top').normal, [0, 1, 0]);
  });

  it('classifyPoint works in translated space', () => {
    // Top face should be at y=50 (30 + 20)
    expect(b.classifyPoint([10, 50, 30])).toBe('top');
  });

  it('children() returns child', () => {
    expect(b.children()).toHaveLength(1);
  });
});

describe('Scale topology', () => {
  const s = sphere(10).scale(2);

  it('scales radius', () => {
    const face = s.faces()[0];
    expect(face.radius).toBe(20);
  });
});

describe('Rotate topology', () => {
  const b = box(100, 60, 30).rotateZ(90);

  it('preserves face count', () => {
    expect(b.faces()).toHaveLength(6);
  });

  it('rotates normals', () => {
    // After 90° around Z: right [1,0,0] becomes [0,1,0]
    const right = getFace(b, 'right');
    expect(Math.abs(right.normal[0])).toBeLessThan(EPSILON);
    expect(Math.abs(right.normal[1] - 1)).toBeLessThan(EPSILON);
  });
});

describe('Mirror topology', () => {
  const b = box(100, 60, 30).mirror('x');

  it('preserves face count', () => {
    expect(b.faces()).toHaveLength(6);
  });

  it('classifyPoint works through mirror', () => {
    expect(b.classifyPoint([50, 0, 0])).toBe('right');
    expect(b.classifyPoint([-50, 0, 0])).toBe('right');
  });
});

// ─── Boolean Genealogy ────────────────────────────────────────

describe('Subtract topology', () => {
  const result = box(100, 60, 30).subtract(cylinder(5, 40), 'hole_1');

  it('has box faces + prefixed cylinder faces', () => {
    expect(hasFace(result, 'top')).toBe(true);
    expect(hasFace(result, 'bottom')).toBe(true);
    expect(hasFace(result, 'hole_1.barrel')).toBe(true);
    expect(hasFace(result, 'hole_1.top_cap')).toBe(true);
    expect(hasFace(result, 'hole_1.bottom_cap')).toBe(true);
  });

  it('inverts B face normals', () => {
    // Barrel normal on cylinder is [1,0,0], inverted should be [-1,0,0]
    const barrel = getFace(result, 'hole_1.barrel');
    expect(barrel.normal[0]).toBeLessThan(0);
  });

  it('classifyPoint on box surface returns box face', () => {
    expect(result.classifyPoint([50, 0, 0])).toBe('right');
  });

  it('classifyPoint on hole surface returns prefixed face', () => {
    // Point on cylinder barrel at [5, 0, 0] — the cylinder is at origin
    const face = result.classifyPoint([5, 0, 0]);
    expect(face).toBe('hole_1.barrel');
  });

  it('children() returns both children', () => {
    expect(result.children()).toHaveLength(2);
  });
});

describe('Subtract auto-naming', () => {
  it('auto-names when no feature name provided', () => {
    const r = box(10, 10, 10).subtract(sphere(3));
    // Should have subtract_N prefix
    const faces = r.faces();
    const hasPrefixed = faces.some(f => f.name.startsWith('subtract_'));
    expect(hasPrefixed).toBe(true);
  });
});

describe('Union topology', () => {
  const result = box(100, 60, 30).union(sphere(20));

  it('merges faces from both children', () => {
    // Box has 6 + Sphere has 1 = 7, but no name collision
    expect(hasFace(result, 'top')).toBe(true);
    expect(hasFace(result, 'surface')).toBe(true);
  });

  it('handles name collision with a./b. prefix', () => {
    // Two spheres unioned → both have "surface", should get a.surface and b.surface
    const r = sphere(10).union(sphere(20));
    expect(hasFace(r, 'a.surface')).toBe(true);
    expect(hasFace(r, 'b.surface')).toBe(true);
  });
});

describe('Intersect topology', () => {
  const result = box(100, 60, 30).intersect(sphere(40));

  it('merges faces from both children', () => {
    expect(hasFace(result, 'top')).toBe(true);
    expect(hasFace(result, 'surface')).toBe(true);
  });
});

// ─── Smooth Booleans ──────────────────────────────────────────

describe('SmoothSubtract topology', () => {
  const result = box(100, 60, 30).smoothSubtract(cylinder(5, 40), 2, 'pocket_1');

  it('has prefixed B faces', () => {
    expect(hasFace(result, 'pocket_1.barrel')).toBe(true);
    expect(hasFace(result, 'pocket_1.top_cap')).toBe(true);
  });

  it('preserves A faces', () => {
    expect(hasFace(result, 'top')).toBe(true);
    expect(hasFace(result, 'bottom')).toBe(true);
  });
});

// ─── Modifiers ────────────────────────────────────────────────

describe('Shell topology', () => {
  const s = box(100, 60, 30).shell(2);

  it('doubles faces with outer_ and inner_ prefixes', () => {
    expect(hasFace(s, 'outer_top')).toBe(true);
    expect(hasFace(s, 'inner_top')).toBe(true);
    expect(hasFace(s, 'outer_right')).toBe(true);
    expect(hasFace(s, 'inner_right')).toBe(true);
    expect(s.faces()).toHaveLength(12); // 6 * 2
  });

  it('inner faces have inverted normals', () => {
    const outerTop = getFace(s, 'outer_top');
    const innerTop = getFace(s, 'inner_top');
    nearVec3(innerTop.normal, [-outerTop.normal[0], -outerTop.normal[1], -outerTop.normal[2]]);
  });

  it('classifyPoint distinguishes outer from inner', () => {
    // Point on outer surface of box (y=30)
    expect(s.classifyPoint([0, 30, 0])).toBe('outer_top');
    // Point on inner surface (y=29, inside the original)
    expect(s.classifyPoint([0, 29, 0])).toBe('inner_top');
  });
});

describe('Round topology', () => {
  const r = box(100, 60, 30).round(2);

  it('passes through child faces', () => {
    expect(r.faces()).toHaveLength(6);
    expect(hasFace(r, 'top')).toBe(true);
  });

  it('passes through child edges', () => {
    expect(r.edges()).toHaveLength(12);
  });

  it('classifyPoint delegates to child', () => {
    expect(r.classifyPoint([50, 0, 0])).toBe('right');
  });
});

describe('Elongate topology', () => {
  const e = sphere(10).elongate(20, 0, 0);

  it('passes through child faces', () => {
    expect(e.faces()).toHaveLength(1);
    expect(e.faces()[0].name).toBe('surface');
  });

  it('classifyPoint delegates through elongation', () => {
    expect(e.classifyPoint([20, 0, 0])).toBe('surface');
  });
});

// ─── Extrude/Revolve ──────────────────────────────────────────

describe('Extrude (circle) topology', () => {
  const e = extrude(circle2d(10), 20);

  it('has top, bottom, and wall faces', () => {
    expect(faceNames(e)).toEqual(['bottom', 'top', 'wall']);
  });

  it('top and bottom are planar', () => {
    expect(getFace(e, 'top').kind).toBe('planar');
    expect(getFace(e, 'bottom').kind).toBe('planar');
  });

  it('wall is cylindrical', () => {
    const wall = getFace(e, 'wall');
    expect(wall.kind).toBe('cylindrical');
    expect(wall.radius).toBe(10);
  });

  it('classifyPoint identifies top cap', () => {
    expect(e.classifyPoint([0, 0, 10])).toBe('top');
  });

  it('classifyPoint identifies wall', () => {
    expect(e.classifyPoint([10, 0, 0])).toBe('wall');
  });
});

describe('Extrude (rect) topology', () => {
  const e = extrude(rect2d(40, 20), 30);

  it('has top, bottom, and 4 wall faces', () => {
    expect(e.faces()).toHaveLength(6);
    expect(hasFace(e, 'top')).toBe(true);
    expect(hasFace(e, 'wall_right')).toBe(true);
    expect(hasFace(e, 'wall_left')).toBe(true);
    expect(hasFace(e, 'wall_front')).toBe(true);
    expect(hasFace(e, 'wall_back')).toBe(true);
  });

  it('wall_right is planar with correct origin', () => {
    const wr = getFace(e, 'wall_right');
    expect(wr.kind).toBe('planar');
    expect(wr.origin![0]).toBeCloseTo(20); // half of 40
  });

  it('classifyPoint identifies wall_right', () => {
    expect(e.classifyPoint([20, 0, 0])).toBe('wall_right');
  });

  it('classifyPoint identifies wall_front', () => {
    expect(e.classifyPoint([0, 10, 0])).toBe('wall_front');
  });
});

describe('Extrude (polygon) topology', () => {
  const tri = polygon([[0, 0], [30, 0], [15, 20]]);
  const e = extrude(tri, 10);

  it('has top, bottom, and freeform wall', () => {
    expect(faceNames(e)).toEqual(['bottom', 'top', 'wall']);
  });

  it('wall is freeform', () => {
    expect(getFace(e, 'wall').kind).toBe('freeform');
  });
});

describe('Revolve (circle) topology', () => {
  const r = revolve(circle2d(5), 20);

  it('has 1 toroidal surface', () => {
    expect(r.faces()).toHaveLength(1);
    expect(r.faces()[0].kind).toBe('toroidal');
    expect(r.faces()[0].radius).toBe(5);
  });

  it('classifyPoint returns surface', () => {
    expect(r.classifyPoint([20, 0, 0])).toBe('surface');
  });
});

describe('Revolve (rect) topology', () => {
  const r = revolve(rect2d(10, 20), 30);

  it('has top, bottom, outer_wall, inner_wall', () => {
    expect(hasFace(r, 'top')).toBe(true);
    expect(hasFace(r, 'bottom')).toBe(true);
    expect(hasFace(r, 'outer_wall')).toBe(true);
    expect(hasFace(r, 'inner_wall')).toBe(true);
  });

  it('outer_wall is cylindrical with correct radius', () => {
    const ow = getFace(r, 'outer_wall');
    expect(ow.kind).toBe('cylindrical');
    expect(ow.radius).toBe(35); // offset 30 + halfW 5
  });

  it('inner_wall is cylindrical with correct radius', () => {
    const iw = getFace(r, 'inner_wall');
    expect(iw.kind).toBe('cylindrical');
    expect(iw.radius).toBe(25); // offset 30 - halfW 5
  });

  it('classifyPoint identifies top face', () => {
    expect(r.classifyPoint([30, 0, 10])).toBe('top');
  });

  it('classifyPoint identifies outer_wall', () => {
    expect(r.classifyPoint([35, 0, 0])).toBe('outer_wall');
  });
});

// ─── Complex Scenarios ────────────────────────────────────────

describe('Box with named hole (end-to-end)', () => {
  const b = box(100, 60, 30);
  const cyl = cylinder(5, 40).translate(20, 0, 0);
  const result = b.subtract(cyl, 'hole_1');

  it('query_faces returns all expected faces', () => {
    const names = faceNames(result);
    expect(names).toContain('top');
    expect(names).toContain('bottom');
    expect(names).toContain('front');
    expect(names).toContain('back');
    expect(names).toContain('left');
    expect(names).toContain('right');
    expect(names).toContain('hole_1.barrel');
    expect(names).toContain('hole_1.top_cap');
    expect(names).toContain('hole_1.bottom_cap');
  });

  it('hole_1.barrel has correct kind and radius', () => {
    const barrel = getFace(result, 'hole_1.barrel');
    expect(barrel.kind).toBe('cylindrical');
    expect(barrel.radius).toBe(5);
  });

  it('top face has correct normal', () => {
    const top = result.face('top');
    nearVec3(top.normal, [0, 1, 0]);
    expect(top.kind).toBe('planar');
  });
});

describe('Bracket with 2 holes (end-to-end)', () => {
  const base = box(100, 60, 20);
  const hole1 = cylinder(5, 30).translate(25, 0, 0);
  const hole2 = cylinder(5, 30).translate(-25, 0, 0);
  const result = base.subtract(hole1, 'bolt_hole_1').subtract(hole2, 'bolt_hole_2');

  it('has both hole face sets', () => {
    expect(hasFace(result, 'bolt_hole_1.barrel')).toBe(true);
    expect(hasFace(result, 'bolt_hole_2.barrel')).toBe(true);
  });

  it('preserves original box faces', () => {
    expect(hasFace(result, 'top')).toBe(true);
    expect(hasFace(result, 'right')).toBe(true);
  });

  it('face count is correct', () => {
    // 6 box + 3 hole1 + 3 hole2 = 12
    expect(result.faces()).toHaveLength(12);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────

describe('Edge cases', () => {
  it('edge() throws for unknown face pair', () => {
    const b = box(10, 10, 10);
    expect(() => b.edge('top', 'nonexistent')).toThrow(/not found/i);
  });

  it('edge() finds valid edge by face pair', () => {
    const b = box(10, 10, 10);
    const e = b.edge('top', 'front');
    expect(e.faces).toContain('top');
    expect(e.faces).toContain('front');
  });

  it('children() returns empty for primitives', () => {
    expect(box(10, 10, 10).children()).toEqual([]);
    expect(sphere(10).children()).toEqual([]);
  });

  it('children() returns both for booleans', () => {
    const a = box(10, 10, 10);
    const b = sphere(5);
    const u = a.union(b);
    expect(u.children()).toHaveLength(2);
  });

  it('children() returns child for transforms', () => {
    const b = box(10, 10, 10).translate(1, 2, 3);
    expect(b.children()).toHaveLength(1);
  });

  it('children() returns child for modifiers', () => {
    const b = box(10, 10, 10).shell(1);
    expect(b.children()).toHaveLength(1);
  });
});

// ─── Edge Topology Completion ─────────────────────────────────

function edgeNames(shape: { edges(): EdgeDescriptor[] }): string[] {
  return shape.edges().map(e => e.name).sort();
}

describe('Edge collision handling (mergeEdges)', () => {
  it('Union of two boxes prefixes edge names with a./b.', () => {
    const a = box(10, 10, 10);
    const b = box(20, 20, 20);
    const u = a.union(b);
    const edges = u.edges();
    // 12 + 12 = 24 edges total
    expect(edges).toHaveLength(24);
    // All edge names should start with a. or b.
    for (const e of edges) {
      expect(e.name).toMatch(/^[ab]\./);
    }
  });

  it('Union of two boxes prefixes face references in edges', () => {
    const a = box(10, 10, 10);
    const b = box(20, 20, 20);
    const u = a.union(b);
    const edges = u.edges();
    for (const e of edges) {
      expect(e.faces[0]).toMatch(/^[ab]\./);
      expect(e.faces[1]).toMatch(/^[ab]\./);
    }
  });

  it('Union of box + sphere has no collision — no prefixing', () => {
    const b = box(10, 10, 10);
    const s = sphere(5);
    const u = b.union(s);
    const edges = u.edges();
    // 12 box edges + 0 sphere edges = 12
    expect(edges).toHaveLength(12);
    // No prefixing
    expect(edges[0].name).not.toMatch(/^[ab]\./);
  });

  it('Intersect of two boxes prefixes edge names with a./b.', () => {
    const a = box(10, 10, 10);
    const b = box(20, 20, 20);
    const i = a.intersect(b);
    const edges = i.edges();
    expect(edges).toHaveLength(24);
    for (const e of edges) {
      expect(e.name).toMatch(/^[ab]\./);
    }
  });

  it('Intersect of box + sphere has no collision — no prefixing', () => {
    const b = box(10, 10, 10);
    const s = sphere(5);
    const i = b.intersect(s);
    expect(i.edges()).toHaveLength(12);
  });
});

describe('Smooth boolean edge propagation', () => {
  it('SmoothUnion propagates edges like Union', () => {
    const a = box(10, 10, 10);
    const s = sphere(5);
    const su = a.smoothUnion(s, 2);
    expect(su.edges()).toHaveLength(12);
  });

  it('SmoothUnion with collision prefixes edges', () => {
    const a = box(10, 10, 10);
    const b = box(20, 20, 20);
    const su = a.smoothUnion(b, 2);
    expect(su.edges()).toHaveLength(24);
    for (const e of su.edges()) {
      expect(e.name).toMatch(/^[ab]\./);
      expect(e.faces[0]).toMatch(/^[ab]\./);
    }
  });

  it('SmoothSubtract prefixes edges with feature name', () => {
    const b = box(100, 60, 30);
    const c = cylinder(5, 40);
    const result = b.smoothSubtract(c, 2, 'pocket');
    const edges = result.edges();
    // 12 box edges + 2 cylinder arc edges = 14
    expect(edges).toHaveLength(14);
    // Cylinder edges should be prefixed
    const pocketEdges = edges.filter(e => e.name.startsWith('pocket.'));
    expect(pocketEdges).toHaveLength(2);
    // Face references should also be prefixed
    for (const e of pocketEdges) {
      expect(e.faces[0]).toMatch(/^pocket\./);
      expect(e.faces[1]).toMatch(/^pocket\./);
    }
  });

  it('SmoothIntersect propagates edges like Intersect', () => {
    const b = box(10, 10, 10);
    const s = sphere(5);
    const si = b.smoothIntersect(s, 2);
    expect(si.edges()).toHaveLength(12);
  });
});

describe('Shell edge doubling', () => {
  it('Shell doubles edges with outer_/inner_ prefixes', () => {
    const b = box(10, 10, 10);
    const s = b.shell(1);
    const edges = s.edges();
    // 12 * 2 = 24 edges
    expect(edges).toHaveLength(24);
  });

  it('Shell edge names have correct prefixes', () => {
    const b = box(10, 10, 10);
    const s = b.shell(1);
    const edges = s.edges();
    const outerEdges = edges.filter(e => e.name.startsWith('outer_'));
    const innerEdges = edges.filter(e => e.name.startsWith('inner_'));
    expect(outerEdges).toHaveLength(12);
    expect(innerEdges).toHaveLength(12);
  });

  it('Shell edge face references match shell face names', () => {
    const b = box(10, 10, 10);
    const s = b.shell(1);
    const fNames = new Set(s.faces().map(f => f.name));
    for (const e of s.edges()) {
      expect(fNames.has(e.faces[0])).toBe(true);
      expect(fNames.has(e.faces[1])).toBe(true);
    }
  });

  it('Shell of cylinder doubles 2 edges to 4', () => {
    const c = cylinder(5, 10);
    const s = c.shell(1);
    expect(s.edges()).toHaveLength(4);
  });
});

describe('Edge error messages', () => {
  it('edge() error includes available edge names', () => {
    const b = box(10, 10, 10);
    expect(() => b.edge('top', 'nonexistent')).toThrow(/12 edge/);
    expect(() => b.edge('top', 'nonexistent')).toThrow(/top\.front/);
  });

  it('edge() error on edgeless shape shows 0 edges', () => {
    const s = sphere(5);
    expect(() => s.edge('surface', 'surface')).toThrow(/0 edge/);
  });

  it('edge() bidirectional lookup works', () => {
    const b = box(10, 10, 10);
    const e1 = b.edge('top', 'front');
    const e2 = b.edge('front', 'top');
    expect(e1.name).toBe(e2.name);
  });
});

describe('Transform edge propagation', () => {
  it('Translate shifts edge midpoints', () => {
    const b = box(10, 10, 10).translate(100, 200, 300);
    const e = b.edge('top', 'front');
    // Original midpoint is [0, 5, 5], translated by [100, 200, 300]
    expect(e.midpoint![0]).toBeCloseTo(100);
    expect(e.midpoint![1]).toBeCloseTo(205);
    expect(e.midpoint![2]).toBeCloseTo(305);
  });

  it('Scale scales edge midpoints', () => {
    const b = box(10, 10, 10).scale(2);
    const e = b.edge('top', 'front');
    // Original midpoint is [0, 5, 5], scaled by 2
    expect(e.midpoint![0]).toBeCloseTo(0);
    expect(e.midpoint![1]).toBeCloseTo(10);
    expect(e.midpoint![2]).toBeCloseTo(10);
  });

  it('Translate preserves edge count', () => {
    const b = box(10, 10, 10).translate(5, 5, 5);
    expect(b.edges()).toHaveLength(12);
  });
});

describe('Chained edge propagation', () => {
  it('box.subtract(cyl).shell() propagates edges through chain', () => {
    const b = box(100, 60, 30);
    const c = cylinder(5, 40);
    const result = b.subtract(c, 'hole').shell(2);
    const edges = result.edges();
    // (12 box + 2 cyl) * 2 (shell) = 28
    expect(edges).toHaveLength(28);
    // Should have outer and inner versions of hole edges
    const outerHoleEdges = edges.filter(e => e.name.startsWith('outer_hole.'));
    const innerHoleEdges = edges.filter(e => e.name.startsWith('inner_hole.'));
    expect(outerHoleEdges).toHaveLength(2);
    expect(innerHoleEdges).toHaveLength(2);
  });

  it('Subtract edge face refs are consistent with face names', () => {
    const b = box(100, 60, 30);
    const c = cylinder(5, 40);
    const result = b.subtract(c, 'hole');
    const fNames = new Set(result.faces().map(f => f.name));
    for (const e of result.edges()) {
      expect(fNames.has(e.faces[0])).toBe(true);
      expect(fNames.has(e.faces[1])).toBe(true);
    }
  });
});
