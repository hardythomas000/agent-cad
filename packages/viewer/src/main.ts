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
import { executeCode, isError, getToolpathVisual, getGCodeText, type ExecuteSuccess } from './kernel-bridge.js';
import { getTheme, setTheme, onThemeChange, type ThemeMode } from './theme.js';

// ─── DOM elements ──────────────────────────────────────────────

const editorPane = document.getElementById('editor-pane')!;
const editorContainer = document.getElementById('editor-container')!;
const divider = document.getElementById('divider')!;
const viewportPane = document.getElementById('viewport-pane')!;
const dropOverlay = document.getElementById('drop-overlay')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusMode = document.getElementById('status-mode')!;
const statusTris = document.getElementById('status-tris')!;
const statusDims = document.getElementById('status-dims')!;
const emptyState = document.getElementById('empty-state')!;
const editorError = document.getElementById('editor-error')!;
const gcodeContent = document.getElementById('gcode-content')!;

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
        break;
    }
  });
});
