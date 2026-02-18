/**
 * STL loading — uses Three.js STLLoader, wraps with material + edges.
 */

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { HEX } from './theme.js';

export interface LoadedModel {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;     // hard edges (30° threshold)
  wireframe: THREE.LineSegments; // all triangle edges
  triangleCount: number;
  bounds: THREE.Box3;
}

const stlLoader = new STLLoader();

/** Load an STL from an ArrayBuffer and return mesh + edges. */
export function loadSTLBuffer(buffer: ArrayBuffer): LoadedModel {
  const geometry = stlLoader.parse(buffer);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // Gold material from aesthetic
  const material = new THREE.MeshStandardMaterial({
    color: HEX.geometry,
    metalness: 0.3,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // Hard edges (30° threshold — feature edges only)
  const edgeGeo = new THREE.EdgesGeometry(geometry, 30);
  const edgeMat = new THREE.LineBasicMaterial({
    color: HEX.wireframe,
    opacity: 0.5,
    transparent: true,
  });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);

  // Wireframe — all triangle edges
  const wireGeo = new THREE.WireframeGeometry(geometry);
  const wireMat = new THREE.LineBasicMaterial({
    color: HEX.wireframe,
    opacity: 0.5,
    transparent: true,
  });
  const wireframe = new THREE.LineSegments(wireGeo, wireMat);

  const bounds = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute,
  );

  return {
    mesh,
    edges,
    wireframe,
    triangleCount: geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position') as THREE.BufferAttribute).count / 3,
    bounds,
  };
}

/** Load STL from a File object. */
export async function loadSTLFile(file: File): Promise<LoadedModel> {
  const buffer = await file.arrayBuffer();
  return loadSTLBuffer(buffer);
}

/** Load STL from a URL. */
export async function loadSTLUrl(url: string): Promise<LoadedModel> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return loadSTLBuffer(buffer);
}
