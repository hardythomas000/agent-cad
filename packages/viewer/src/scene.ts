/**
 * Three.js scene setup — renderer, camera, lights, grid, axes.
 */

import * as THREE from 'three';
import { HEX } from './theme.js';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  modelGroup: THREE.Group;
  edgeGroup: THREE.Group;
  gridHelper: THREE.GridHelper;
  axesHelper: THREE.AxesHelper;
}

export function initScene(container: HTMLElement): SceneContext {
  // Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(HEX.bg);
  container.appendChild(renderer.domElement);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HEX.bg);

  // Camera
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50000);
  camera.position.set(150, 120, 200);

  // Lights — three-point rig with ambient
  const keyLight = new THREE.DirectionalLight(HEX.keyLight, 1.2);
  keyLight.position.set(200, 300, 200);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(HEX.fillLight, 0.3);
  fillLight.position.set(-200, 100, -100);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(HEX.rimLight, 0.4);
  rimLight.position.set(0, -100, -200);
  scene.add(rimLight);

  const ambient = new THREE.AmbientLight(HEX.ambient, 0.6);
  scene.add(ambient);

  // Grid
  const gridHelper = new THREE.GridHelper(500, 50, HEX.grid, HEX.grid);
  gridHelper.material.opacity = 0.12;
  (gridHelper.material as THREE.Material).transparent = true;
  scene.add(gridHelper);

  // Axes
  const axesHelper = new THREE.AxesHelper(50);
  scene.add(axesHelper);

  // Model group (meshes go here)
  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  // Edge group (wireframe overlays)
  const edgeGroup = new THREE.Group();
  scene.add(edgeGroup);

  // Resize handling
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  return { scene, camera, renderer, modelGroup, edgeGroup, gridHelper, axesHelper };
}

export function startRenderLoop(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  onBeforeRender?: () => void,
): void {
  function animate() {
    requestAnimationFrame(animate);
    onBeforeRender?.();
    renderer.render(scene, camera);
  }
  animate();
}
