/**
 * Toolpath Renderer — converts ToolpathResult to Three.js vertex-colored lines.
 *
 * Single LineSegments object with per-vertex colors:
 *   Rapids = red (0xe06060)
 *   Cuts   = teal (0x4a9e8e)
 *   Plunges = gold (0xc9a84c)
 *
 * Colors are hardcoded CAM conventions — they don't change with theme.
 */

import * as THREE from 'three';
import type { ToolpathResult } from '@agent-cad/sdf-kernel';

const RAPID_COLOR  = new THREE.Color(0xe06060);
const CUT_COLOR    = new THREE.Color(0x4a9e8e);
const PLUNGE_COLOR = new THREE.Color(0xc9a84c);

function colorForType(type: 'rapid' | 'cut' | 'plunge'): THREE.Color {
  switch (type) {
    case 'rapid':  return RAPID_COLOR;
    case 'cut':    return CUT_COLOR;
    case 'plunge': return PLUNGE_COLOR;
  }
}

/**
 * Convert a ToolpathResult into a single THREE.LineSegments with vertex colors.
 * Returns null if the toolpath has fewer than 2 points.
 */
export function renderToolpath(toolpath: ToolpathResult): THREE.LineSegments | null {
  const pts = toolpath.points;
  if (pts.length < 2) return null;

  // Count segments (each consecutive pair of points is a segment)
  const segCount = pts.length - 1;

  // Pre-allocate: 2 vertices per segment, 3 floats per vertex
  const positions = new Float32Array(segCount * 6);
  const colors = new Float32Array(segCount * 6);

  for (let i = 0; i < segCount; i++) {
    const prev = pts[i];
    const curr = pts[i + 1];
    const color = colorForType(curr.type);

    const base = i * 6;

    // Segment start (previous point)
    positions[base]     = prev.x;
    positions[base + 1] = prev.y;
    positions[base + 2] = prev.z;

    // Segment end (current point)
    positions[base + 3] = curr.x;
    positions[base + 4] = curr.y;
    positions[base + 5] = curr.z;

    // Both vertices get the same color (determined by the move type)
    colors[base]     = color.r;
    colors[base + 1] = color.g;
    colors[base + 2] = color.b;
    colors[base + 3] = color.r;
    colors[base + 4] = color.g;
    colors[base + 5] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({ vertexColors: true });

  return new THREE.LineSegments(geometry, material);
}
