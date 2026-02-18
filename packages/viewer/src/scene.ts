/**
 * Three.js scene setup — renderer, cameras, lights, grid, axes.
 */

import * as THREE from 'three';
import { HEX, onThemeChange } from './theme.js';

export interface SceneContext {
  scene: THREE.Scene;
  perspCamera: THREE.PerspectiveCamera;
  orthoCamera: THREE.OrthographicCamera;
  activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  modelGroup: THREE.Group;
  edgeGroup: THREE.Group;     // hard edges
  wireGroup: THREE.Group;     // full wireframe
  gridHelper: THREE.GridHelper;
  axesHelper: THREE.AxesHelper;
  setCamera: (type: 'perspective' | 'orthographic') => void;
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

  // Cameras
  const perspCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 50000);
  perspCamera.position.set(150, 120, 200);

  const orthoCamera = new THREE.OrthographicCamera(-200, 200, 150, -150, 0.1, 50000);
  orthoCamera.position.copy(perspCamera.position);
  orthoCamera.lookAt(0, 0, 0);

  let activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspCamera;

  function setCamera(type: 'perspective' | 'orthographic') {
    const from = activeCamera;
    const to = type === 'perspective' ? perspCamera : orthoCamera;
    if (from === to) return;

    // Copy position and orientation
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);

    if (to instanceof THREE.OrthographicCamera) {
      // Set ortho frustum based on distance to target
      const dist = from.position.length();
      const aspect = container.clientWidth / container.clientHeight;
      const halfH = dist * Math.tan((45 * Math.PI) / 360);
      to.left = -halfH * aspect;
      to.right = halfH * aspect;
      to.top = halfH;
      to.bottom = -halfH;
      to.updateProjectionMatrix();
    }

    activeCamera = to;
    ctx.activeCamera = to;
  }

  // Lights
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
  gridHelper.material.opacity = HEX.gridOpacity;
  (gridHelper.material as THREE.Material).transparent = true;
  scene.add(gridHelper);

  // Axes
  const axesHelper = new THREE.AxesHelper(50);
  scene.add(axesHelper);

  // Groups
  const modelGroup = new THREE.Group();
  scene.add(modelGroup);
  const edgeGroup = new THREE.Group();
  scene.add(edgeGroup);
  const wireGroup = new THREE.Group();
  scene.add(wireGroup);

  // React to theme changes
  onThemeChange(() => {
    renderer.setClearColor(HEX.bg);
    scene.background = new THREE.Color(HEX.bg);
    ambient.color.set(HEX.ambient);
    gridHelper.material.opacity = HEX.gridOpacity;
    (gridHelper.material as any).color?.set(HEX.grid);
  });

  // Resize handling
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    perspCamera.aspect = w / h;
    perspCamera.updateProjectionMatrix();
    const aspect = w / h;
    const halfH = (orthoCamera.top - orthoCamera.bottom) / 2 || 150;
    orthoCamera.left = -halfH * aspect;
    orthoCamera.right = halfH * aspect;
    orthoCamera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const ctx: SceneContext = {
    scene, perspCamera, orthoCamera, activeCamera, renderer,
    modelGroup, edgeGroup, wireGroup, gridHelper, axesHelper, setCamera,
  };
  return ctx;
}

export function startRenderLoop(
  ctx: SceneContext,
  onBeforeRender?: () => void,
): void {
  function animate() {
    requestAnimationFrame(animate);
    onBeforeRender?.();
    ctx.renderer.render(ctx.scene, ctx.activeCamera);
  }
  animate();
}
