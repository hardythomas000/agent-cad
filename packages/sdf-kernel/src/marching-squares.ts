/**
 * Marching Squares — 2D contour extraction from SDF cross-sections.
 *
 * Given a 2D scalar field (SDF evaluated at a fixed Y/Z plane),
 * extracts zero-isosurface contours as ordered polyline loops.
 *
 * Used by contour toolpath generation: slice the SDF at a given Z level
 * (CNC convention) to get 2D profile outlines.
 *
 * Algorithm:
 *   1. Evaluate SDF on a regular grid
 *   2. Classify each cell (4 corners) into one of 16 cases
 *   3. Emit edge segments with linear interpolation
 *   4. Stitch segments into ordered loops via endpoint hashing
 */

export interface ContourLoop {
  points: [number, number][];
  closed: boolean;
}

// ─── Marching Squares Core ─────────────────────────────────────

/**
 * Extract zero-isosurface contours from a 2D scalar field.
 *
 * @param evaluate - (x, z) => signed distance value
 * @param bounds - Rectangular evaluation region
 * @param cellSize - Grid cell size in mm
 * @returns Array of contour loops (outer + inner)
 */
export function extractContours(
  evaluate: (x: number, z: number) => number,
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number },
  cellSize: number,
): ContourLoop[] {
  if (cellSize <= 0) throw new Error('cellSize must be positive');

  const nx = Math.ceil((bounds.xMax - bounds.xMin) / cellSize);
  const nz = Math.ceil((bounds.zMax - bounds.zMin) / cellSize);

  if (nx === 0 || nz === 0) return [];

  // Evaluate grid values (nx+1 × nz+1 grid)
  const cols = nx + 1;
  const rows = nz + 1;
  const values = new Float32Array(cols * rows);

  for (let iz = 0; iz < rows; iz++) {
    const z = bounds.zMin + iz * cellSize;
    for (let ix = 0; ix < cols; ix++) {
      const x = bounds.xMin + ix * cellSize;
      values[iz * cols + ix] = evaluate(x, z);
    }
  }

  // Extract segments from each cell
  const segments: [[number, number], [number, number]][] = [];

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x0 = bounds.xMin + ix * cellSize;
      const z0 = bounds.zMin + iz * cellSize;
      const x1 = x0 + cellSize;
      const z1 = z0 + cellSize;

      // Corner values: BL, BR, TR, TL (bottom-left origin)
      const vBL = values[iz * cols + ix];
      const vBR = values[iz * cols + ix + 1];
      const vTR = values[(iz + 1) * cols + ix + 1];
      const vTL = values[(iz + 1) * cols + ix];

      // Case index: bit 0 = BL, bit 1 = BR, bit 2 = TR, bit 3 = TL
      // Inside (negative SDF) = 1, outside (positive) = 0
      const caseIndex =
        (vBL < 0 ? 1 : 0) |
        (vBR < 0 ? 2 : 0) |
        (vTR < 0 ? 4 : 0) |
        (vTL < 0 ? 8 : 0);

      if (caseIndex === 0 || caseIndex === 15) continue; // All outside or all inside

      // Edge midpoints with linear interpolation
      // Bottom edge: BL-BR, Right edge: BR-TR, Top edge: TL-TR, Left edge: BL-TL
      const bx = lerp(x0, x1, vBL, vBR);
      const rx = lerp(z0, z1, vBR, vTR);
      const tx = lerp(x0, x1, vTL, vTR);
      const lx = lerp(z0, z1, vBL, vTL);

      const bottom: [number, number] = [bx, z0];
      const right: [number, number] = [x1, rx];
      const top: [number, number] = [tx, z1];
      const left: [number, number] = [x0, lx];

      // 16-case lookup table
      switch (caseIndex) {
        case 1:  segments.push([bottom, left]); break;
        case 2:  segments.push([right, bottom]); break;
        case 3:  segments.push([right, left]); break;
        case 4:  segments.push([top, right]); break;
        case 5:  // Saddle: BL+TR inside
          segments.push([top, left]);
          segments.push([right, bottom]);
          break;
        case 6:  segments.push([top, bottom]); break;
        case 7:  segments.push([top, left]); break;
        case 8:  segments.push([left, top]); break;
        case 9:  segments.push([bottom, top]); break;
        case 10: // Saddle: BR+TL inside
          segments.push([bottom, left]);
          segments.push([top, right]);
          break;
        case 11: segments.push([right, top]); break;
        case 12: segments.push([left, right]); break;
        case 13: segments.push([bottom, right]); break;
        case 14: segments.push([left, bottom]); break;
        // case 0, 15: already handled above
      }
    }
  }

  return stitchContours(segments);
}

// ─── Linear Interpolation ──────────────────────────────────────

/** Interpolate between a and b where the zero crossing is, based on signed distance values. */
function lerp(a: number, b: number, va: number, vb: number): number {
  const denom = va - vb;
  if (Math.abs(denom) < 1e-12) return (a + b) / 2;
  const t = va / denom;
  return a + t * (b - a);
}

// ─── Contour Stitching ─────────────────────────────────────────

/**
 * Stitch unordered line segments into ordered polyline loops.
 * Uses endpoint hashing to find matching segment endpoints.
 */
function stitchContours(
  segments: [[number, number], [number, number]][],
): ContourLoop[] {
  if (segments.length === 0) return [];

  // Hash endpoint to find matching segments
  const PRECISION = 6;
  function key(p: [number, number]): string {
    return `${p[0].toFixed(PRECISION)},${p[1].toFixed(PRECISION)}`;
  }

  // Build adjacency: endpoint → list of (segIndex, whichEnd)
  type EndRef = { seg: number; end: 0 | 1 };
  const adj = new Map<string, EndRef[]>();

  for (let i = 0; i < segments.length; i++) {
    const k0 = key(segments[i][0]);
    const k1 = key(segments[i][1]);
    if (!adj.has(k0)) adj.set(k0, []);
    if (!adj.has(k1)) adj.set(k1, []);
    adj.get(k0)!.push({ seg: i, end: 0 });
    adj.get(k1)!.push({ seg: i, end: 1 });
  }

  const used = new Uint8Array(segments.length);
  const loops: ContourLoop[] = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;

    const points: [number, number][] = [segments[start][0], segments[start][1]];
    let currentKey = key(points[points.length - 1]);

    // Walk forward, connecting segments
    let extended = true;
    while (extended) {
      extended = false;
      const neighbors = adj.get(currentKey);
      if (!neighbors) break;

      for (const ref of neighbors) {
        if (used[ref.seg]) continue;
        used[ref.seg] = 1;

        // Append the OTHER end of the matched segment
        const nextPt = ref.end === 0 ? segments[ref.seg][1] : segments[ref.seg][0];
        points.push(nextPt);
        currentKey = key(nextPt);
        extended = true;
        break;
      }
    }

    // Check if the loop is closed (last point matches first)
    const firstKey = key(points[0]);
    const lastKey = key(points[points.length - 1]);
    const closed = firstKey === lastKey;

    // Remove duplicate closing point if closed
    if (closed && points.length > 1) {
      points.pop();
    }

    if (points.length >= 2) {
      loops.push({ points, closed });
    }
  }

  return loops;
}
