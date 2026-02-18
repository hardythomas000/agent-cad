/**
 * CAD-style OrbitControls — middle=rotate, shift+middle=pan, scroll=zoom.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function initControls(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  domElement: HTMLElement,
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);

  // CAD-style mouse: middle=orbit, right=pan, left=free for selection
  controls.mouseButtons = {
    LEFT: -1 as THREE.MOUSE,    // Disable (reserved for future selection)
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN,
  };

  // Smooth damping
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Speed tuning
  controls.rotateSpeed = 0.8;
  controls.panSpeed = 0.6;
  controls.zoomSpeed = 1.2;

  // Limits
  controls.minDistance = 0.1;
  controls.maxDistance = 50000;

  return controls;
}
