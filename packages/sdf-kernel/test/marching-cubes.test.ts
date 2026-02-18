import { describe, it, expect } from 'vitest';
import { sphere, box, cylinder } from '../src/api.js';
import { marchingCubes } from '../src/marching-cubes.js';
import { exportSTL } from '../src/stl.js';
import { length, sub } from '../src/vec3.js';

describe('marchingCubes', () => {
  it('meshes a sphere with vertices near the surface', () => {
    const s = sphere(10);
    const mesh = marchingCubes(s, 2);
    expect(mesh.triangleCount).toBeGreaterThan(100);
    expect(mesh.vertexCount).toBe(mesh.triangleCount * 3);

    // Every vertex should be near the sphere surface (within resolution)
    for (const v of mesh.vertices) {
      const dist = Math.abs(length(v) - 10);
      expect(dist).toBeLessThan(2.5); // within ~resolution
    }
  });

  it('sphere mesh bounds match radius', () => {
    const s = sphere(10);
    const mesh = marchingCubes(s, 2);
    for (let i = 0; i < 3; i++) {
      expect(mesh.bounds.min[i]).toBeGreaterThan(-12);
      expect(mesh.bounds.max[i]).toBeLessThan(12);
      expect(mesh.bounds.min[i]).toBeLessThan(-8);
      expect(mesh.bounds.max[i]).toBeGreaterThan(8);
    }
  });

  it('meshes a box', () => {
    const b = box(20, 20, 20);
    const mesh = marchingCubes(b, 2);
    expect(mesh.triangleCount).toBeGreaterThan(10);
    // Box mesh should have bounds near [-10, 10]
    for (let i = 0; i < 3; i++) {
      expect(mesh.bounds.min[i]).toBeGreaterThan(-12);
      expect(mesh.bounds.max[i]).toBeLessThan(12);
    }
  });

  it('meshes a boolean subtract (box minus cylinder)', () => {
    const part = box(30, 30, 30).subtract(cylinder(5, 40));
    const mesh = marchingCubes(part, 2);
    expect(mesh.triangleCount).toBeGreaterThan(50);
    // Verify the hole exists: evaluate center should be outside (positive SDF)
    expect(part.evaluate([0, 0, 0])).toBeGreaterThan(0);
  });

  it('finer resolution produces more triangles', () => {
    const s = sphere(10);
    const coarse = marchingCubes(s, 4);
    const fine = marchingCubes(s, 2);
    expect(fine.triangleCount).toBeGreaterThan(coarse.triangleCount);
  });

  it('returns empty mesh for shape outside bounds', () => {
    const s = sphere(5);
    // Custom bounds that don't contain the sphere
    const mesh = marchingCubes(s, 1, { min: [100, 100, 100], max: [110, 110, 110] }, 0);
    expect(mesh.triangleCount).toBe(0);
    expect(mesh.vertexCount).toBe(0);
  });

  it('rejects non-positive resolution', () => {
    const s = sphere(10);
    expect(() => marchingCubes(s, 0)).toThrow('Resolution must be positive');
    expect(() => marchingCubes(s, -1)).toThrow('Resolution must be positive');
  });

  it('rejects grid that is too large', () => {
    const s = sphere(10);
    expect(() => marchingCubes(s, 0.01)).toThrow('Grid too large');
  });

  it('indices reference valid vertices', () => {
    const s = sphere(10);
    const mesh = marchingCubes(s, 2);
    for (const idx of mesh.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(mesh.vertexCount);
    }
  });

  it('meshes a rotated box', () => {
    const b = box(20, 10, 10).rotateZ(45);
    const mesh = marchingCubes(b, 2);
    expect(mesh.triangleCount).toBeGreaterThan(10);
    // Rotated 20mm box diagonal extends further than 10 in X/Y
    const xSpan = mesh.bounds.max[0] - mesh.bounds.min[0];
    expect(xSpan).toBeGreaterThan(12); // wider than unrotated height
  });

  it('meshes a scaled sphere', () => {
    const s = sphere(5).scale(3); // effective radius 15
    const mesh = marchingCubes(s, 2);
    expect(mesh.triangleCount).toBeGreaterThan(50);
    // Bounds should reflect scaled radius
    expect(mesh.bounds.max[0]).toBeGreaterThan(13);
    expect(mesh.bounds.min[0]).toBeLessThan(-13);
  });

  it('meshes a smooth union', () => {
    const a = sphere(8).translate(-5, 0, 0);
    const b = sphere(8).translate(5, 0, 0);
    const smooth = a.smoothUnion(b, 3);
    const mesh = marchingCubes(smooth, 2);
    expect(mesh.triangleCount).toBeGreaterThan(50);
    // Smooth union is larger than either sphere alone
    expect(mesh.bounds.max[0]).toBeGreaterThan(12);
    expect(mesh.bounds.min[0]).toBeLessThan(-12);
  });

  it('meshes a very small shape relative to resolution', () => {
    const tiny = sphere(1); // 2mm diameter
    const mesh = marchingCubes(tiny, 0.5); // fine enough to capture the shape
    expect(mesh.triangleCount).toBeGreaterThan(10);
    expect(mesh.vertexCount).toBe(mesh.triangleCount * 3);
    // No NaN in any vertex
    for (const v of mesh.vertices) {
      for (let i = 0; i < 3; i++) {
        expect(Number.isFinite(v[i])).toBe(true);
      }
    }
  });

  it('produces no NaN vertices (interpolation safety)', () => {
    // Two overlapping spheres create near-equal SDF values in the
    // overlap region, exercising the denominator guard in interpolate()
    const a = sphere(5).translate(-1, 0, 0);
    const b = sphere(5).translate(1, 0, 0);
    const mesh = marchingCubes(a.union(b), 4);
    expect(mesh.triangleCount).toBeGreaterThan(10);
    for (const v of mesh.vertices) {
      for (let i = 0; i < 3; i++) {
        expect(Number.isFinite(v[i])).toBe(true);
      }
    }
  });
});

describe('exportSTL', () => {
  it('produces correct binary size', () => {
    const s = sphere(10);
    const mesh = marchingCubes(s, 3);
    const stl = exportSTL(mesh);
    expect(stl.byteLength).toBe(84 + mesh.triangleCount * 50);
  });

  it('has correct triangle count in header', () => {
    const s = sphere(10);
    const mesh = marchingCubes(s, 3);
    const stl = exportSTL(mesh);
    const view = new DataView(stl);
    expect(view.getUint32(80, true)).toBe(mesh.triangleCount);
  });

  it('face normals are unit vectors', () => {
    const s = sphere(10);
    const mesh = marchingCubes(s, 3);
    const stl = exportSTL(mesh);
    const view = new DataView(stl);
    let offset = 84;
    for (let t = 0; t < mesh.triangleCount; t++) {
      const nx = view.getFloat32(offset, true);
      const ny = view.getFloat32(offset + 4, true);
      const nz = view.getFloat32(offset + 8, true);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      // Normal should be unit length (or zero for degenerate triangles)
      if (len > 0.01) {
        expect(Math.abs(len - 1)).toBeLessThan(0.01);
      }
      offset += 50;
    }
  });

  it('custom header is written', () => {
    const mesh = marchingCubes(sphere(5), 3);
    const stl = exportSTL(mesh, 'test-header');
    const view = new DataView(stl);
    // Check first bytes match header
    const dec = new TextDecoder();
    const headerBytes = new Uint8Array(stl, 0, 11);
    expect(dec.decode(headerBytes)).toBe('test-header');
  });

  it('rejects empty mesh', () => {
    const emptyMesh = marchingCubes(sphere(5), 1, { min: [100, 100, 100], max: [110, 110, 110] }, 0);
    expect(emptyMesh.triangleCount).toBe(0);
    expect(() => exportSTL(emptyMesh)).toThrow('Cannot export empty mesh');
  });

  it('rejects header exceeding 80 bytes', () => {
    const mesh = marchingCubes(sphere(5), 3);
    const longHeader = 'A'.repeat(81);
    expect(() => exportSTL(mesh, longHeader)).toThrow('STL header exceeds 80 bytes');
  });

  it('rejects multibyte header exceeding 80 bytes', () => {
    const mesh = marchingCubes(sphere(5), 3);
    // 30 emoji chars = 120 UTF-8 bytes (4 bytes each)
    const emojiHeader = '\u{1F4A0}'.repeat(30);
    expect(() => exportSTL(mesh, emojiHeader)).toThrow('STL header exceeds 80 bytes');
  });

  it('sphere normals are consistently oriented (winding order)', () => {
    const s = sphere(10);
    const mesh = marchingCubes(s, 3);
    const stl = exportSTL(mesh);
    const view = new DataView(stl);
    let inwardCount = 0;
    let outwardCount = 0;
    let offset = 84;
    for (let t = 0; t < mesh.triangleCount; t++) {
      const nx = view.getFloat32(offset, true);
      const ny = view.getFloat32(offset + 4, true);
      const nz = view.getFloat32(offset + 8, true);
      // First vertex of this triangle
      const vx = view.getFloat32(offset + 12, true);
      const vy = view.getFloat32(offset + 16, true);
      const vz = view.getFloat32(offset + 20, true);
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nLen > 0.01) {
        // For a sphere at origin, dot(normal, vertex) reveals orientation
        const dot = nx * vx + ny * vy + nz * vz;
        if (dot > 0) outwardCount++;
        else inwardCount++;
      }
      offset += 50;
    }
    // Normals should be consistently oriented (>90% one direction)
    const total = inwardCount + outwardCount;
    const dominant = Math.max(inwardCount, outwardCount);
    expect(dominant / total).toBeGreaterThan(0.9);
  });
});
