/**
 * Binary STL export.
 *
 * Format: 80-byte header + uint32 count + 50 bytes per triangle.
 * Face normals computed via cross product (standard for slicers).
 */

import type { Vec3 } from './vec3.js';
import { sub, cross, normalize } from './vec3.js';
import type { TriangleMesh } from './mesh.js';

export function exportSTL(mesh: TriangleMesh, header = 'agent-cad'): ArrayBuffer {
  if (mesh.triangleCount === 0) {
    throw new Error('Cannot export empty mesh (0 triangles)');
  }
  const enc = new TextEncoder();
  const headerBytes = enc.encode(header);
  if (headerBytes.length > 80) {
    throw new Error(
      `STL header exceeds 80 bytes (got ${headerBytes.length}). Shorten the header string.`
    );
  }

  const { vertices, indices, triangleCount } = mesh;
  if (indices.length !== triangleCount * 3) {
    throw new Error(
      `Mesh data inconsistent: indices.length (${indices.length}) !== triangleCount * 3 (${triangleCount * 3})`
    );
  }
  const size = 84 + triangleCount * 50;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  // Header (80 bytes, pad with zeros)
  for (let i = 0; i < headerBytes.length; i++) {
    view.setUint8(i, headerBytes[i]);
  }

  // Triangle count
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let t = 0; t < triangleCount; t++) {
    const v0 = vertices[indices[t * 3]];
    const v1 = vertices[indices[t * 3 + 1]];
    const v2 = vertices[indices[t * 3 + 2]];

    // Face normal via cross product
    const e1 = sub(v1, v0);
    const e2 = sub(v2, v0);
    const n = normalize(cross(e1, e2));

    // Normal
    view.setFloat32(offset, n[0], true); offset += 4;
    view.setFloat32(offset, n[1], true); offset += 4;
    view.setFloat32(offset, n[2], true); offset += 4;
    // Vertex 1
    view.setFloat32(offset, v0[0], true); offset += 4;
    view.setFloat32(offset, v0[1], true); offset += 4;
    view.setFloat32(offset, v0[2], true); offset += 4;
    // Vertex 2
    view.setFloat32(offset, v1[0], true); offset += 4;
    view.setFloat32(offset, v1[1], true); offset += 4;
    view.setFloat32(offset, v1[2], true); offset += 4;
    // Vertex 3
    view.setFloat32(offset, v2[0], true); offset += 4;
    view.setFloat32(offset, v2[1], true); offset += 4;
    view.setFloat32(offset, v2[2], true); offset += 4;
    // Attribute byte count
    view.setUint16(offset, 0, true); offset += 2;
  }

  return buffer;
}
