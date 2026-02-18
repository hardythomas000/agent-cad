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
import { executeCode, isError, type ExecuteSuccess } from './kernel-bridge.js';

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

// ─── Scene + controls ──────────────────────────────────────────

const ctx = initScene(viewportPane);
const controls = initControls(ctx.camera, ctx.renderer.domElement);

startRenderLoop(ctx.renderer, ctx.scene, ctx.camera, () => {
  controls.update();
});

// ─── Model state ───────────────────────────────────────────────

let showWireframe = false;
let showGrid = true;
let showAxes = true;
let firstRender = true;

/** Dispose GPU resources (geometry + material) for all children, then clear. */
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

function displayModel(model: LoadedModel, filename: string): void {
  disposeGroup(ctx.modelGroup);
  disposeGroup(ctx.edgeGroup);

  ctx.modelGroup.add(model.mesh);
  ctx.edgeGroup.add(model.edges);
  model.edges.visible = showWireframe;

  emptyState.classList.add('hidden');
  fitCamera(ctx.camera, controls, ctx.modelGroup);

  statusMode.textContent = filename;
  statusMode.className = '';
  statusTris.textContent = model.triangleCount.toLocaleString();

  const size = new THREE.Vector3();
  model.bounds.getSize(size);
  statusDims.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
}

/** Display geometry from the kernel bridge (live execution). */
function displayGeometry(result: ExecuteSuccess): void {
  disposeGroup(ctx.modelGroup);
  disposeGroup(ctx.edgeGroup);

  ctx.modelGroup.add(result.mesh);
  ctx.edgeGroup.add(result.edges);
  result.edges.visible = showWireframe;

  emptyState.classList.add('hidden');

  // Only fit camera on first successful render
  if (firstRender) {
    fitCamera(ctx.camera, controls, ctx.modelGroup);
    firstRender = false;
  }

  // Update status
  statusMode.textContent = 'Live';
  statusMode.className = 'status-live';
  statusTris.textContent = result.triangleCount.toLocaleString();

  const size = new THREE.Vector3();
  result.bounds.getSize(size);
  statusDims.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;

  // Clear error
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
  if (isError(result)) {
    showError(result.error);
  } else {
    displayGeometry(result);
  }
}

// Debounce helper
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

// Run the initial default code on startup
runCode(editor.state.doc.toString());

// ─── Ctrl+Enter to run immediately ─────────────────────────────

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
    ctx.camera.aspect = w / h;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(w, h);
  }
});

// ─── STL drop/load (still works alongside live mode) ───────────

initDropZone(viewportPane, dropOverlay, fileInput, async (file: File) => {
  try {
    const model = await loadSTLFile(file);
    displayModel(model, file.name);
  } catch (err) {
    console.error('Failed to load STL:', err);
    showError(`STL load failed: ${(err as Error).message}`);
  }
});

// ─── Toolbar buttons ───────────────────────────────────────────

document.querySelectorAll('.toolbar-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (ctx.modelGroup.children.length === 0) return;
    const preset = (btn as HTMLElement).dataset.view as ViewPreset;
    const bounds = new THREE.Box3().setFromObject(ctx.modelGroup);
    setView(preset, ctx.camera, controls, bounds);
  });
});

document.querySelector('.toolbar-btn[data-action="fit"]')?.addEventListener('click', () => {
  if (ctx.modelGroup.children.length > 0) {
    fitCamera(ctx.camera, controls, ctx.modelGroup);
  }
});

document.querySelector('.toolbar-btn[data-action="load"]')?.addEventListener('click', () => {
  fileInput.click();
});

document.querySelector('.toolbar-btn[data-action="run"]')?.addEventListener('click', () => {
  runCode(editor.state.doc.toString());
});

// Toggle buttons
document.querySelectorAll('.toolbar-btn[data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const toggle = (btn as HTMLElement).dataset.toggle;
    switch (toggle) {
      case 'wireframe':
        showWireframe = !showWireframe;
        ctx.edgeGroup.visible = showWireframe;
        btn.classList.toggle('active', showWireframe);
        break;
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
    }
  });
});
