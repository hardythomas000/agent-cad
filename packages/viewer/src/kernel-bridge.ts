/**
 * Kernel bridge — executes editor DSL code against the SDF kernel
 * and converts results to Three.js BufferGeometry.
 */

import * as THREE from 'three';
import {
  SDF,
  box, sphere, cylinder, cone, torus, plane,
  union, subtract, intersect,
  marchingCubes,
  type TriangleMesh,
} from '@agent-cad/sdf-kernel';
import { HEX } from './theme.js';

export interface ExecuteSuccess {
  geometry: THREE.BufferGeometry;
  edges: THREE.LineSegments;
  mesh: THREE.Mesh;
  triangleCount: number;
  bounds: THREE.Box3;
}

export interface ExecuteError {
  error: string;
}

export type ExecuteResult = ExecuteSuccess | ExecuteError;

export function isError(r: ExecuteResult): r is ExecuteError {
  return 'error' in r;
}

// All SDF prototype methods that return new SDF nodes.
// Patched during execution to track the last SDF produced by any operation,
// including method chains like box(50,50,50).subtract(sphere(30)).
const SDF_METHODS = [
  'union', 'subtract', 'intersect',
  'smoothUnion', 'smoothSubtract', 'smoothIntersect',
  'translate', 'at', 'rotateX', 'rotateY', 'rotateZ',
  'scale', 'mirror', 'shell', 'round', 'elongate',
] as const;

/**
 * Execute DSL code from the editor. Injects kernel API functions as globals.
 *
 * SDF tracking: Every primitive constructor AND every SDF method call
 * (.subtract, .translate, .round, etc.) updates `lastSDF` via prototype
 * patching. This ensures method chain results are captured, not just
 * the last primitive created.
 *
 * Priority: explicit computeMesh() > lastSDF > error.
 */
export function executeCode(code: string): ExecuteResult {
  let lastSDF: SDF | null = null;
  let meshResult: TriangleMesh | null = null;

  // Patch SDF.prototype methods to track the last SDF produced
  const originals = new Map<string, Function>();
  for (const name of SDF_METHODS) {
    const orig = (SDF.prototype as any)[name];
    if (typeof orig !== 'function') continue;
    originals.set(name, orig);
    (SDF.prototype as any)[name] = function (this: SDF, ...args: any[]) {
      const result = orig.apply(this, args);
      lastSDF = result;
      return result;
    };
  }

  try {
    // Wrapped primitives that also track lastSDF
    const track = (val: SDF): SDF => { lastSDF = val; return val; };
    const _box = (...args: Parameters<typeof box>) => track(box(...args));
    const _sphere = (...args: Parameters<typeof sphere>) => track(sphere(...args));
    const _cylinder = (...args: Parameters<typeof cylinder>) => track(cylinder(...args));
    const _cone = (...args: Parameters<typeof cone>) => track(cone(...args));
    const _torus = (...args: Parameters<typeof torus>) => track(torus(...args));
    const _plane = (...args: Parameters<typeof plane>) => track(plane(...args));
    const _union = (...args: Parameters<typeof union>) => track(union(...args));
    const _subtract = (...args: Parameters<typeof subtract>) => track(subtract(...args));
    const _intersect = (...args: Parameters<typeof intersect>) => track(intersect(...args));

    // computeMesh — explicit mesh generation
    const computeMesh = (shape: SDF, resolution = 2.0): TriangleMesh => {
      const m = marchingCubes(shape, resolution);
      meshResult = m;
      return m;
    };

    // exportSTL — no-op in viewer (just returns null to avoid errors)
    const _exportSTL = () => null;

    const fn = new Function(
      'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
      'union', 'subtract', 'intersect',
      'computeMesh', 'exportSTL',
      code,
    );

    fn(
      _box, _sphere, _cylinder, _cone, _torus, _plane,
      _union, _subtract, _intersect,
      computeMesh, _exportSTL,
    );

    // If computeMesh was called explicitly, use that result
    if (meshResult) {
      return meshToResult(meshResult);
    }

    // Otherwise auto-mesh the last SDF at resolution 2.0
    if (lastSDF) {
      const m = marchingCubes(lastSDF, 2.0);
      return meshToResult(m);
    }

    return { error: 'No geometry produced. Assign a shape (e.g. box(50,50,50)).' };
  } catch (err) {
    return { error: (err as Error).message };
  } finally {
    // Always restore original SDF methods
    for (const [name, orig] of originals) {
      (SDF.prototype as any)[name] = orig;
    }
  }
}

/** Convert kernel TriangleMesh to Three.js BufferGeometry + Mesh + Edges. */
function meshToResult(triMesh: TriangleMesh): ExecuteResult {
  if (triMesh.triangleCount === 0) {
    return { error: 'Mesh has 0 triangles. Check shape dimensions.' };
  }

  // Build position buffer from vertices + indices
  const positions = new Float32Array(triMesh.indices.length * 3);
  for (let i = 0; i < triMesh.indices.length; i++) {
    const v = triMesh.vertices[triMesh.indices[i]];
    positions[i * 3] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // Gold material matching existing aesthetic
  const material = new THREE.MeshStandardMaterial({
    color: HEX.geometry,
    metalness: 0.3,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);

  // Wireframe — all triangle edges
  const wireGeo = new THREE.WireframeGeometry(geometry);
  const wireMat = new THREE.LineBasicMaterial({
    color: HEX.wireframe,
    opacity: 0.5,
    transparent: true,
  });
  const edges = new THREE.LineSegments(wireGeo, wireMat);

  const bounds = new THREE.Box3();
  bounds.setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);

  return {
    geometry,
    edges,
    mesh,
    triangleCount: triMesh.triangleCount,
    bounds,
  };
}
