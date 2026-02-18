/**
 * Camera view presets — Front/Back/Left/Right/Top/Bottom/Iso + Fit.
 */

import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

const VIEW_DIRECTIONS: Record<ViewPreset, THREE.Vector3> = {
  front:  new THREE.Vector3(0, 0, 1),
  back:   new THREE.Vector3(0, 0, -1),
  left:   new THREE.Vector3(-1, 0, 0),
  right:  new THREE.Vector3(1, 0, 0),
  top:    new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
  iso:    new THREE.Vector3(1, 1, 1).normalize(),
};

/** Snap camera to a preset view of the given bounding box. */
export function setView(
  preset: ViewPreset,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  bounds: THREE.Box3,
): void {
  const center = new THREE.Vector3();
  bounds.getCenter(center);

  const size = new THREE.Vector3();
  bounds.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 1.8;

  const dir = VIEW_DIRECTIONS[preset];
  camera.position.copy(center).addScaledVector(dir, dist);

  // For top/bottom, adjust the up vector so the view isn't degenerate
  if (preset === 'top') {
    camera.up.set(0, 0, -1);
  } else if (preset === 'bottom') {
    camera.up.set(0, 0, 1);
  } else {
    camera.up.set(0, 1, 0);
  }

  controls.target.copy(center);
  camera.lookAt(center);
  controls.update();

  // Adjust near/far
  camera.near = Math.max(0.01, dist * 0.001);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
}

/** Fit camera to frame the model group. */
export function fitCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  group: THREE.Group,
): void {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;

  const center = new THREE.Vector3();
  box.getCenter(center);

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  const fov = camera.fov * (Math.PI / 180);
  const dist = (sphere.radius / Math.sin(fov / 2)) * 1.3;

  // Keep current direction
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);

  controls.target.copy(center);
  controls.update();

  camera.near = Math.max(0.01, dist * 0.001);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
}
