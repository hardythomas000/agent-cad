/**
 * Kernel bridge — executes editor DSL code against the SDF kernel
 * and converts results to Three.js BufferGeometry.
 */

import * as THREE from 'three';
import {
  SDF,
  box, sphere, cylinder, cone, torus, plane,
  polygon, circle2d, rect2d, extrude, revolve,
  union, subtract, intersect,
  marchingCubes,
  generateRasterSurfacing,
  emitFanucGCode,
  hole,
  pocket,
  boltCircle,
  chamfer,
  fillet,
  findTool,
  listTools,
  listLibraries,
  type SDF2D,
  type TriangleMesh,
  type ToolDefinition,
  type ToolpathParams,
  type HoleOptions,
  type PocketOptions,
  type BoltCircleOptions,
} from '@agent-cad/sdf-kernel';
import { HEX } from './theme.js';
import { renderToolpath } from './toolpath-renderer.js';

export interface ExecuteSuccess {
  geometry: THREE.BufferGeometry;
  edges: THREE.LineSegments;     // hard edges (30° threshold)
  wireframe: THREE.LineSegments; // all triangle edges
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

// ─── Toolpath + G-code state (module-level stashing) ────────────

let toolpathVisual: THREE.LineSegments | null = null;
let gcodeText: string | null = null;

/** Get the toolpath visual from the last executeCode() call, if any. */
export function getToolpathVisual(): THREE.LineSegments | null {
  return toolpathVisual;
}

/** Get the G-code text from the last executeCode() call, if any. */
export function getGCodeText(): string | null {
  return gcodeText;
}

// ─── Face map state (for hover highlighting) ───────────────────

export interface FaceMapData {
  faceIds: Int32Array;        // per-triangle face index
  faceNames: string[];        // face index → face name
  faceInfo: Map<string, { kind: string; origin?: [number, number, number]; radius?: number }>;
}

let currentFaceMap: FaceMapData | null = null;

/** Get the face map from the last executeCode() call, if any. */
export function getFaceMap(): FaceMapData | null {
  return currentFaceMap;
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
  let meshSDF: SDF | null = null; // Track which SDF was explicitly meshed
  toolpathVisual = null; // Reset each execution
  gcodeText = null;
  currentFaceMap = null;

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

    // 2D profile constructors (passthrough — no 3D tracking needed)
    const _polygon = (...args: Parameters<typeof polygon>) => polygon(...args);
    const _circle2d = (...args: Parameters<typeof circle2d>) => circle2d(...args);
    const _rect2d = (...args: Parameters<typeof rect2d>) => rect2d(...args);

    // 2D → 3D bridge (these produce tracked 3D SDFs)
    const _extrude = (profile: SDF2D, height: number) => track(extrude(profile, height));
    const _revolve = (profile: SDF2D, offset?: number) => track(revolve(profile, offset));

    // Semantic feature constructors
    const _hole = (shape: SDF, face: string, opts: HoleOptions) => track(hole(shape, face, opts));
    const _pocket = (shape: SDF, face: string, opts: PocketOptions) => track(pocket(shape, face, opts));
    const _boltCircle = (shape: SDF, face: string, opts: BoltCircleOptions) => track(boltCircle(shape, face, opts));

    // Edge operations
    const _chamfer = (shape: SDF, edge: string, size: number, name?: string) =>
      track(chamfer(shape, edge, size, name));
    const _fillet = (shape: SDF, edge: string, radius: number, name?: string) =>
      track(fillet(shape, edge, radius, name));

    // computeMesh — explicit mesh generation
    const computeMesh = (shape: SDF, resolution = 2.0): TriangleMesh => {
      const m = marchingCubes(shape, resolution);
      meshResult = m;
      meshSDF = shape;
      return m;
    };

    // exportSTL — no-op in viewer (just returns null to avoid errors)
    const _exportSTL = () => null;

    // defineTool — create a ToolDefinition for CAM
    const _defineTool = (opts: { type: 'ballnose'; diameter: number; flute_length?: number; shank_diameter?: number }): ToolDefinition => {
      return {
        name: 'tool',
        type: opts.type,
        diameter: opts.diameter,
        radius: opts.diameter / 2,
        flute_length: opts.flute_length,
        shank_diameter: opts.shank_diameter,
      };
    };

    // showToolpath — generate and render a surfacing toolpath
    const _showToolpath = (shape: SDF, tool: ToolDefinition, params: Partial<ToolpathParams> & { feed_rate: number; rpm: number; safe_z: number }) => {
      const fullParams: ToolpathParams = {
        direction: 'x',
        stepover_pct: 15,
        zigzag: true,
        ...params,
      };
      const tp = generateRasterSurfacing(shape, tool, fullParams);
      const result = { ...tp, id: 'live' };
      toolpathVisual = renderToolpath(result);
      gcodeText = emitFanucGCode(result);
      console.log('Toolpath stats:', result.stats);
    };

    const fn = new Function(
      'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
      'polygon', 'circle2d', 'rect2d', 'extrude', 'revolve',
      'union', 'subtract', 'intersect',
      'computeMesh', 'exportSTL',
      'defineTool', 'showToolpath',
      'hole', 'pocket', 'boltCircle',
      'chamfer', 'fillet',
      'findTool', 'listTools', 'listLibraries',
      code,
    );

    fn(
      _box, _sphere, _cylinder, _cone, _torus, _plane,
      _polygon, _circle2d, _rect2d, _extrude, _revolve,
      _union, _subtract, _intersect,
      computeMesh, _exportSTL,
      _defineTool, _showToolpath,
      _hole, _pocket, _boltCircle,
      _chamfer, _fillet,
      findTool, listTools, listLibraries,
    );

    // If computeMesh was called explicitly, use that result
    if (meshResult) {
      return meshToResult(meshResult, meshSDF ?? undefined);
    }

    // Otherwise auto-mesh the last SDF at resolution 2.0
    if (lastSDF) {
      const m = marchingCubes(lastSDF, 2.0);
      return meshToResult(m, lastSDF);
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
function meshToResult(triMesh: TriangleMesh, sdf?: SDF): ExecuteResult {
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

  // Vertex colors for face highlighting (default white = no tint)
  const colors = new Float32Array(positions.length);
  colors.fill(1.0);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Gold material with vertex colors enabled
  const material = new THREE.MeshStandardMaterial({
    color: HEX.geometry,
    metalness: 0.3,
    roughness: 0.5,
    side: THREE.DoubleSide,
    vertexColors: true,
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

  const bounds = new THREE.Box3();
  bounds.setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);

  // ─── Face classification (for hover highlighting) ─────────────
  if (sdf && triMesh.triangleCount <= 200_000) {
    const faceIds = new Int32Array(triMesh.triangleCount);
    const faceNames: string[] = [];
    const faceNameToId = new Map<string, number>();
    const faceInfo = new Map<string, { kind: string; origin?: [number, number, number]; radius?: number }>();

    // Pre-fetch all face descriptors for status bar info
    const allFaces = sdf.faces();
    const faceByName = new Map(allFaces.map(f => [f.name, f]));

    for (let i = 0; i < triMesh.triangleCount; i++) {
      const base = i * 9;
      const cx = (positions[base] + positions[base + 3] + positions[base + 6]) / 3;
      const cy = (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3;
      const cz = (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3;
      const faceName = sdf.classifyPoint([cx, cy, cz]) ?? '__unknown__';

      let id = faceNameToId.get(faceName);
      if (id === undefined) {
        id = faceNames.length;
        faceNames.push(faceName);
        faceNameToId.set(faceName, id);
        const desc = faceByName.get(faceName);
        if (desc) {
          faceInfo.set(faceName, {
            kind: desc.kind,
            origin: desc.origin as [number, number, number] | undefined,
            radius: desc.radius,
          });
        }
      }
      faceIds[i] = id;
    }
    currentFaceMap = { faceIds, faceNames, faceInfo };
  } else {
    currentFaceMap = null;
  }

  return {
    geometry,
    edges,
    wireframe,
    mesh,
    triangleCount: triMesh.triangleCount,
    bounds,
  };
}
