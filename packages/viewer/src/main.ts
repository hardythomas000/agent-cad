/**
 * Agent CAD Viewer — entry point.
 * Wires scene, controls, editor, kernel bridge, STL loading, and view presets.
 */

import * as THREE from 'three';
import { initScene, startRenderLoop } from './scene.js';
import { initControls } from './controls.js';
import { initEditor } from './editor.js';
import { initSplitPane } from './split-pane.js';
import { initDropZone } from './drop-zone.js';
import { loadSTLFile, type LoadedModel } from './stl-loader.js';
import { setView, fitCamera, type ViewPreset } from './view-presets.js';
import { executeCode, isError, getToolpathVisual, getGCodeText, getFaceMap, type ExecuteSuccess, type FaceMapData } from './kernel-bridge.js';
import { getTheme, setTheme, onThemeChange, type ThemeMode } from './theme.js';

// ─── DOM elements ──────────────────────────────────────────────

const editorPane = document.getElementById('editor-pane')!;
const editorContainer = document.getElementById('editor-container')!;
const divider = document.getElementById('divider')!;
const viewportPane = document.getElementById('viewport-pane')!;
const dropOverlay = document.getElementById('drop-overlay')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusMode = document.getElementById('status-mode')!;
const statusFace = document.getElementById('status-face')!;
const statusTris = document.getElementById('status-tris')!;
const statusDims = document.getElementById('status-dims')!;
const emptyState = document.getElementById('empty-state')!;
const editorError = document.getElementById('editor-error')!;
const gcodeContent = document.getElementById('gcode-content')!;
const toolpathLegend = document.getElementById('toolpath-legend')!;

// ─── Scene + controls ──────────────────────────────────────────

const ctx = initScene(viewportPane);
let controls = initControls(ctx.activeCamera, ctx.renderer.domElement);

startRenderLoop(ctx, () => {
  controls.update();
});

// ─── Display modes ─────────────────────────────────────────────

type DisplayMode = 'shaded' | 'shaded-edge' | 'shaded-wire' | 'wire';
let displayMode: DisplayMode = 'shaded';
let cameraType: 'perspective' | 'orthographic' = 'perspective';
let showGrid = true;
let showAxes = true;
let showToolpathLines = true;
let firstRender = true;

function applyDisplayMode(): void {
  switch (displayMode) {
    case 'shaded':
      ctx.modelGroup.visible = true;
      ctx.edgeGroup.visible = false;
      ctx.wireGroup.visible = false;
      break;
    case 'shaded-edge':
      ctx.modelGroup.visible = true;
      ctx.edgeGroup.visible = true;
      ctx.wireGroup.visible = false;
      setGroupOpacity(ctx.edgeGroup, 0.5);
      break;
    case 'shaded-wire':
      ctx.modelGroup.visible = true;
      ctx.edgeGroup.visible = false;
      ctx.wireGroup.visible = true;
      setGroupOpacity(ctx.wireGroup, 0.5);
      break;
    case 'wire':
      ctx.modelGroup.visible = false;
      ctx.edgeGroup.visible = false;
      ctx.wireGroup.visible = true;
      setGroupOpacity(ctx.wireGroup, 1.0);
      break;
  }
}

function setGroupOpacity(group: THREE.Group, opacity: number): void {
  for (const child of group.children) {
    if (child instanceof THREE.LineSegments) {
      const mat = child.material as THREE.LineBasicMaterial;
      mat.opacity = opacity;
      mat.transparent = opacity < 1;
    }
  }
}

applyDisplayMode();

// ─── GPU cleanup ───────────────────────────────────────────────

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  }
  group.clear();
}

// ─── Display functions ─────────────────────────────────────────

function displayModel(model: LoadedModel, filename: string): void {
  disposeGroup(ctx.modelGroup);
  disposeGroup(ctx.edgeGroup);
  disposeGroup(ctx.wireGroup);
  disposeGroup(ctx.toolpathGroup);
  hoveredFaceId = -1;
  statusFace.textContent = '';

  ctx.modelGroup.add(model.mesh);
  ctx.edgeGroup.add(model.edges);
  ctx.wireGroup.add(model.wireframe);
  applyDisplayMode();

  emptyState.classList.add('hidden');
  fitCamera(ctx.activeCamera, controls, ctx.modelGroup);

  statusMode.textContent = filename;
  statusMode.className = '';
  statusTris.textContent = model.triangleCount.toLocaleString();

  const size = new THREE.Vector3();
  model.bounds.getSize(size);
  statusDims.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
}

function displayGeometry(result: ExecuteSuccess): void {
  disposeGroup(ctx.modelGroup);
  disposeGroup(ctx.edgeGroup);
  disposeGroup(ctx.wireGroup);
  hoveredFaceId = -1;
  statusFace.textContent = '';

  ctx.modelGroup.add(result.mesh);
  ctx.edgeGroup.add(result.edges);
  ctx.wireGroup.add(result.wireframe);
  applyDisplayMode();

  emptyState.classList.add('hidden');

  if (firstRender) {
    fitCamera(ctx.activeCamera, controls, ctx.modelGroup);
    firstRender = false;
  }

  statusMode.textContent = 'Live';
  statusMode.className = 'status-live';
  statusTris.textContent = result.triangleCount.toLocaleString();

  const size = new THREE.Vector3();
  result.bounds.getSize(size);
  statusDims.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;

  editorError.classList.remove('visible');
  editorError.textContent = '';
}

function showError(msg: string): void {
  editorError.textContent = msg;
  editorError.classList.add('visible');
  statusMode.textContent = 'Error';
  statusMode.className = 'status-live error';
}

// ─── Live execution ─────────────────────────────────────────────

function runCode(code: string): void {
  const result = executeCode(code);
  // Always dispose and re-populate toolpath group
  disposeGroup(ctx.toolpathGroup);
  if (isError(result)) {
    showError(result.error);
  } else {
    displayGeometry(result);
    const tpVisual = getToolpathVisual();
    if (tpVisual) {
      ctx.toolpathGroup.add(tpVisual);
      ctx.toolpathGroup.visible = showToolpathLines;
      toolpathLegend.classList.toggle('visible', showToolpathLines);
    } else {
      toolpathLegend.classList.remove('visible');
    }
  }
  // G-code readout — auto-show/hide
  const gcode = getGCodeText();
  if (gcode) {
    gcodeContent.textContent = gcode;
    gcodeContent.classList.add('visible');
  } else {
    gcodeContent.textContent = '';
    gcodeContent.classList.remove('visible');
  }
}

function debounce(fn: (arg: string) => void, ms: number): (arg: string) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (arg: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(arg), ms);
  };
}

const debouncedRun = debounce(runCode, 300);

// ─── Editor ────────────────────────────────────────────────────

const editor = initEditor(editorContainer, (code) => {
  debouncedRun(code);
});

requestAnimationFrame(() => runCode(editor.state.doc.toString()));

// ─── Ctrl+Enter ────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runCode(editor.state.doc.toString());
  }
});

// ─── Split pane ────────────────────────────────────────────────

initSplitPane(editorPane, divider, () => {
  const w = viewportPane.clientWidth;
  const h = viewportPane.clientHeight;
  if (w > 0 && h > 0) {
    ctx.perspCamera.aspect = w / h;
    ctx.perspCamera.updateProjectionMatrix();
    const aspect = w / h;
    const halfH = (ctx.orthoCamera.top - ctx.orthoCamera.bottom) / 2 || 150;
    ctx.orthoCamera.left = -halfH * aspect;
    ctx.orthoCamera.right = halfH * aspect;
    ctx.orthoCamera.updateProjectionMatrix();
    ctx.renderer.setSize(w, h);
  }
});

// ─── STL drop/load ─────────────────────────────────────────────

initDropZone(viewportPane, dropOverlay, fileInput, async (file: File) => {
  try {
    const model = await loadSTLFile(file);
    displayModel(model, file.name);
  } catch (err) {
    console.error('Failed to load STL:', err);
    showError(`STL load failed: ${(err as Error).message}`);
  }
});

// ─── Toolbar: view presets ─────────────────────────────────────

document.querySelectorAll('.toolbar-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (ctx.modelGroup.children.length === 0) return;
    const preset = (btn as HTMLElement).dataset.view as ViewPreset;
    const bounds = new THREE.Box3().setFromObject(ctx.modelGroup);
    setView(preset, ctx.activeCamera, controls, bounds);
  });
});

document.querySelector('.toolbar-btn[data-action="fit"]')?.addEventListener('click', () => {
  if (ctx.modelGroup.children.length > 0) {
    fitCamera(ctx.activeCamera, controls, ctx.modelGroup);
  }
});

document.querySelector('.toolbar-btn[data-action="load"]')?.addEventListener('click', () => {
  fileInput.click();
});

document.querySelector('.toolbar-btn[data-action="run"]')?.addEventListener('click', () => {
  runCode(editor.state.doc.toString());
});

// ─── Toolbar: display mode cycle ───────────────────────────────

const DISPLAY_MODES: DisplayMode[] = ['shaded', 'shaded-edge', 'shaded-wire', 'wire'];
const DISPLAY_LABELS: Record<DisplayMode, string> = {
  'shaded': 'Shade',
  'shaded-edge': 'S+E',
  'shaded-wire': 'S+W',
  'wire': 'Wire',
};

const wireBtn = document.querySelector('.toolbar-btn[data-toggle="wireframe"]');
wireBtn?.addEventListener('click', () => {
  const idx = DISPLAY_MODES.indexOf(displayMode);
  displayMode = DISPLAY_MODES[(idx + 1) % DISPLAY_MODES.length];
  applyDisplayMode();
  wireBtn.textContent = DISPLAY_LABELS[displayMode];
  wireBtn.classList.toggle('active', displayMode !== 'shaded');
});

// ─── Toolbar: camera toggle ────────────────────────────────────

const camBtn = document.querySelector('.toolbar-btn[data-toggle="camera"]');
camBtn?.addEventListener('click', () => {
  cameraType = cameraType === 'perspective' ? 'orthographic' : 'perspective';
  ctx.setCamera(cameraType);

  // Recreate controls for the new camera
  const target = controls.target.clone();
  controls.dispose();
  controls = initControls(ctx.activeCamera, ctx.renderer.domElement);
  controls.target.copy(target);
  controls.update();

  camBtn.textContent = cameraType === 'perspective' ? 'Persp' : 'Ortho';
  camBtn.classList.toggle('active', cameraType === 'orthographic');
});

// ─── Toolbar: theme toggle ─────────────────────────────────────

const themeBtn = document.querySelector('.toolbar-btn[data-toggle="theme"]');
themeBtn?.addEventListener('click', () => {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
});

onThemeChange((mode) => {
  document.documentElement.setAttribute('data-theme', mode);
  themeBtn?.classList.toggle('active', mode === 'light');
  runCode(editor.state.doc.toString());
});

document.documentElement.setAttribute('data-theme', getTheme());

// ─── Toolbar: grid/axes toggles ────────────────────────────────

document.querySelectorAll('.toolbar-btn[data-toggle]').forEach((btn) => {
  const toggle = (btn as HTMLElement).dataset.toggle;
  if (toggle === 'wireframe' || toggle === 'theme' || toggle === 'camera') return;
  btn.addEventListener('click', () => {
    switch (toggle) {
      case 'grid':
        showGrid = !showGrid;
        ctx.gridHelper.visible = showGrid;
        btn.classList.toggle('active', showGrid);
        break;
      case 'axes':
        showAxes = !showAxes;
        ctx.axesHelper.visible = showAxes;
        btn.classList.toggle('active', showAxes);
        break;
      case 'toolpath':
        showToolpathLines = !showToolpathLines;
        ctx.toolpathGroup.visible = showToolpathLines;
        btn.classList.toggle('active', showToolpathLines);
        toolpathLegend.classList.toggle('visible', showToolpathLines && ctx.toolpathGroup.children.length > 0);
        break;
    }
  });
});

// ─── Face highlighting (hover to identify) ──────────────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredFaceId = -1;

// Highlight tint: vertex color multiplier that shifts gold toward teal
const HIGHLIGHT_TINT = { r: 0.4, g: 0.9, b: 2.0 };

function highlightFace(faceId: number, faceMap: FaceMapData): void {
  const mesh = ctx.modelGroup.children[0] as THREE.Mesh | undefined;
  if (!mesh?.geometry) return;
  const colorAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colorAttr) return;
  const colors = colorAttr.array as Float32Array;

  for (let tri = 0; tri < faceMap.faceIds.length; tri++) {
    const base = tri * 9; // 3 vertices * 3 components
    if (faceMap.faceIds[tri] === faceId) {
      colors[base]     = HIGHLIGHT_TINT.r;
      colors[base + 1] = HIGHLIGHT_TINT.g;
      colors[base + 2] = HIGHLIGHT_TINT.b;
      colors[base + 3] = HIGHLIGHT_TINT.r;
      colors[base + 4] = HIGHLIGHT_TINT.g;
      colors[base + 5] = HIGHLIGHT_TINT.b;
      colors[base + 6] = HIGHLIGHT_TINT.r;
      colors[base + 7] = HIGHLIGHT_TINT.g;
      colors[base + 8] = HIGHLIGHT_TINT.b;
    } else {
      colors[base]     = 1.0;
      colors[base + 1] = 1.0;
      colors[base + 2] = 1.0;
      colors[base + 3] = 1.0;
      colors[base + 4] = 1.0;
      colors[base + 5] = 1.0;
      colors[base + 6] = 1.0;
      colors[base + 7] = 1.0;
      colors[base + 8] = 1.0;
    }
  }
  colorAttr.needsUpdate = true;
}

function clearHighlight(): void {
  const mesh = ctx.modelGroup.children[0] as THREE.Mesh | undefined;
  if (!mesh?.geometry) return;
  const colorAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colorAttr) return;
  (colorAttr.array as Float32Array).fill(1.0);
  colorAttr.needsUpdate = true;
  statusFace.textContent = '';
}

function showFaceInfo(faceId: number, faceMap: FaceMapData): void {
  const faceName = faceMap.faceNames[faceId];
  if (!faceName || faceName === '__unknown__') {
    statusFace.textContent = '';
    return;
  }
  const info = faceMap.faceInfo.get(faceName);
  let text = faceName;
  if (info) {
    text += ` (${info.kind})`;

    // Hole diameter (cylindrical faces)
    if (info.radius != null) {
      text += ` D=${(info.radius * 2).toFixed(1)}mm`;
    }
    // Chamfer/fillet size (edge break faces)
    else if (info.edgeBreakSize != null) {
      text += info.edgeBreakMode === 'fillet'
        ? ` R=${info.edgeBreakSize.toFixed(1)}mm`
        : ` size=${info.edgeBreakSize.toFixed(1)}mm`;
    }
    // Wall thickness or origin (planar faces)
    else if (info.kind === 'planar') {
      const wall = faceMap.wallThickness?.get(faceName);
      if (wall != null) {
        text += ` wall=${wall.toFixed(1)}mm`;
      } else if (info.origin) {
        const [x, y, z] = info.origin;
        text += ` [${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}]`;
      }
    }
  }
  statusFace.textContent = text;
}

function onViewportMouseMove(e: MouseEvent): void {
  const faceMap = getFaceMap();
  if (!faceMap) return;

  // Don't raycast in wireframe-only mode (no solid mesh)
  if (displayMode === 'wire') return;

  const rect = viewportPane.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, ctx.activeCamera);
  const intersects = raycaster.intersectObject(ctx.modelGroup, true);

  if (intersects.length > 0 && intersects[0].faceIndex != null) {
    const triIndex = Math.floor(intersects[0].faceIndex);
    const faceId = faceMap.faceIds[triIndex];
    if (faceId !== hoveredFaceId) {
      hoveredFaceId = faceId;
      highlightFace(faceId, faceMap);
      showFaceInfo(faceId, faceMap);
    }
  } else {
    if (hoveredFaceId !== -1) {
      hoveredFaceId = -1;
      clearHighlight();
    }
  }
}

// Throttle mousemove to rAF
let rafPending = false;
viewportPane.addEventListener('mousemove', (e) => {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { onViewportMouseMove(e); rafPending = false; });
});

// Clear highlight when mouse leaves viewport
viewportPane.addEventListener('mouseleave', () => {
  if (hoveredFaceId !== -1) {
    hoveredFaceId = -1;
    clearHighlight();
  }
});
