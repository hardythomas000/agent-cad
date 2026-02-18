/**
 * Agent CAD Viewer — entry point.
 * Wires scene, controls, editor, STL loading, and view presets together.
 */

import * as THREE from 'three';
import { initScene, startRenderLoop } from './scene.js';
import { initControls } from './controls.js';
import { initEditor } from './editor.js';
import { initSplitPane } from './split-pane.js';
import { initDropZone } from './drop-zone.js';
import { loadSTLFile, loadSTLUrl, type LoadedModel } from './stl-loader.js';
import { setView, fitCamera, type ViewPreset } from './view-presets.js';

// ─── DOM elements ──────────────────────────────────────────────

const editorPane = document.getElementById('editor-pane')!;
const editorContainer = document.getElementById('editor-container')!;
const divider = document.getElementById('divider')!;
const viewportPane = document.getElementById('viewport-pane')!;
const dropOverlay = document.getElementById('drop-overlay')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusFile = document.getElementById('status-file')!;
const statusTris = document.getElementById('status-tris')!;
const statusDims = document.getElementById('status-dims')!;
const emptyState = document.getElementById('empty-state')!;

// ─── Scene + controls ──────────────────────────────────────────

const ctx = initScene(viewportPane);
const controls = initControls(ctx.camera, ctx.renderer.domElement);

startRenderLoop(ctx.renderer, ctx.scene, ctx.camera, () => {
  controls.update();
});

// ─── Editor ────────────────────────────────────────────────────

initEditor(editorContainer);

// ─── Split pane ────────────────────────────────────────────────

initSplitPane(editorPane, divider, () => {
  // Trigger renderer resize
  const w = viewportPane.clientWidth;
  const h = viewportPane.clientHeight;
  if (w > 0 && h > 0) {
    ctx.camera.aspect = w / h;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(w, h);
  }
});

// ─── Model state ───────────────────────────────────────────────

let currentModel: LoadedModel | null = null;
let showWireframe = false;
let showGrid = true;
let showAxes = true;

function displayModel(model: LoadedModel, filename: string): void {
  // Clear previous
  ctx.modelGroup.clear();
  ctx.edgeGroup.clear();

  // Add new
  ctx.modelGroup.add(model.mesh);
  ctx.edgeGroup.add(model.edges);
  model.edges.visible = showWireframe;

  currentModel = model;

  // Hide empty state
  emptyState.classList.add('hidden');

  // Fit camera
  fitCamera(ctx.camera, controls, ctx.modelGroup);

  // Update status
  statusFile.textContent = filename;
  statusTris.textContent = model.triangleCount.toLocaleString();

  const size = new THREE.Vector3();
  model.bounds.getSize(size);
  statusDims.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
}

// ─── STL loading ───────────────────────────────────────────────

initDropZone(viewportPane, dropOverlay, fileInput, async (file: File) => {
  try {
    const model = await loadSTLFile(file);
    displayModel(model, file.name);
  } catch (err) {
    console.error('Failed to load STL:', err);
    statusFile.textContent = `Error: ${(err as Error).message}`;
  }
});

// ─── Toolbar buttons ───────────────────────────────────────────

document.querySelectorAll('.toolbar-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!currentModel) return;
    const preset = (btn as HTMLElement).dataset.view as ViewPreset;
    setView(preset, ctx.camera, controls, currentModel.bounds);
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

// ─── Auto-load demo bracket ───────────────────────────────────

async function autoLoadDemo(): Promise<void> {
  try {
    const model = await loadSTLUrl('./bracket.stl');
    displayModel(model, 'bracket.stl');
  } catch {
    // bracket.stl not available — that's fine
  }
}

autoLoadDemo();
