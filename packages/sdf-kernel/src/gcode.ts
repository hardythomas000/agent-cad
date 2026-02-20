/**
 * G-code Emitter — Fanuc-compatible 3-axis output.
 *
 * Takes a ToolpathResult and emits a complete NC program:
 *   %, O-number, header comments, G90/G21/G17, spindle, coolant,
 *   G00 rapids, G01 cuts with modal optimization, footer.
 *
 * Modal optimization omits unchanged coordinates and codes,
 * reducing file size by ~40% on typical surfacing programs.
 *
 * Coordinate convention:
 *   Toolpath points are in SDF/viewer convention (Y-up).
 *   G-code needs CNC convention (Z-up). We swap Y↔Z:
 *     G-code X = point.x   (SDF X = CNC X)
 *     G-code Y = point.z   (SDF Z = CNC Y)
 *     G-code Z = point.y   (SDF Y = CNC Z / spindle axis)
 */

import type { ToolpathResult, ContourToolpathResult, MultiLevelContourResult, DrillHole, DrillCycleParams, ToolDefinition } from './toolpath.js';

/** Union type for any toolpath that the linear G-code emitter accepts. */
type AnyLinearToolpathResult = ToolpathResult | ContourToolpathResult | MultiLevelContourResult;

// ─── Config ─────────────────────────────────────────────────────

export interface GCodeConfig {
  program_number?: number;
  work_offset?: string;
  coolant?: 'flood' | 'mist' | 'off';
  comment_style?: 'paren' | 'semicolon';
  decimal_places?: number;
  line_numbers?: boolean;
  rapid_rate?: number;
}

// ─── Shared Helpers (#026) ──────────────────────────────────────

const VALID_WORK_OFFSETS = /^G5[4-9]$/;

function resolveConfig(config?: GCodeConfig) {
  const cfg = {
    program_number: config?.program_number ?? 1001,
    work_offset: config?.work_offset ?? 'G54',
    coolant: config?.coolant ?? 'flood',
    comment_style: config?.comment_style ?? 'paren',
    decimal_places: config?.decimal_places ?? 3,
    line_numbers: config?.line_numbers ?? false,
    rapid_rate: config?.rapid_rate ?? 15000,
  };

  // Input validation (#028)
  if (!VALID_WORK_OFFSETS.test(cfg.work_offset)) {
    throw new Error(
      `Invalid work_offset "${cfg.work_offset}". Must be G54–G59.`
    );
  }

  return cfg;
}

type ResolvedConfig = ReturnType<typeof resolveConfig>;

function createEmitter(cfg: ResolvedConfig) {
  const lines: string[] = [];
  let lineNum = 10;

  function emit(line: string) {
    if (cfg.line_numbers) {
      lines.push(`N${lineNum} ${line}`);
      lineNum += 10;
    } else {
      lines.push(line);
    }
  }

  function comment(text: string): string {
    return cfg.comment_style === 'paren' ? `(${text})` : `; ${text}`;
  }

  function fmt(val: number): string {
    const s = val.toFixed(cfg.decimal_places);
    // Strip trailing zeros: G-code convention "X10." not "X10.000"
    return s.replace(/0+$/, '');
  }

  return { lines, emit, comment, fmt };
}

function validateParams(params: { feed_rate: number; rpm: number; safe_z: number }) {
  if (params.feed_rate <= 0 || params.feed_rate > 99999) {
    throw new Error(`feed_rate must be between 1 and 99999, got ${params.feed_rate}`);
  }
  if (params.rpm <= 0 || params.rpm > 99999) {
    throw new Error(`rpm must be between 1 and 99999, got ${params.rpm}`);
  }
  if (params.safe_z < 0) {
    throw new Error(`safe_z must be non-negative, got ${params.safe_z}`);
  }
}

function emitHeader(
  e: ReturnType<typeof createEmitter>,
  cfg: ResolvedConfig,
  opName: string,
  toolDesc: string,
  shapeName: string,
  feedInfo: string,
  rpm: number,
  safeZ: number,
) {
  e.lines.push('%');
  e.emit(`O${String(cfg.program_number).padStart(4, '0')} ${e.comment(opName)}`);
  e.emit(e.comment(`TOOL: ${toolDesc}`));
  e.emit(e.comment(`SHAPE: ${shapeName}`));
  e.emit(e.comment(`GENERATED: ${new Date().toISOString().split('T')[0]} BY AGENT-CAD`));
  e.emit(e.comment(feedInfo));
  e.emit(`G90 G21 G17 ${e.comment('ABSOLUTE, METRIC, XY PLANE')}`);
  e.emit(`G00 ${cfg.work_offset} X0. Y0. Z${e.fmt(safeZ)} ${e.comment('RAPID TO SAFE Z')}`);
  e.emit(`M03 S${rpm} ${e.comment('SPINDLE ON')}`);
  if (cfg.coolant === 'flood') {
    e.emit(`M08 ${e.comment('COOLANT FLOOD')}`);
  } else if (cfg.coolant === 'mist') {
    e.emit(`M07 ${e.comment('COOLANT MIST')}`);
  }
}

function emitFooter(
  e: ReturnType<typeof createEmitter>,
  cfg: ResolvedConfig,
) {
  e.emit(`M05 ${e.comment('SPINDLE OFF')}`);
  if (cfg.coolant !== 'off') {
    e.emit(`M09 ${e.comment('COOLANT OFF')}`);
  }
  e.emit(`G00 G53 Z0. ${e.comment('HOME Z')}`);
  e.emit(`M30 ${e.comment('END')}`);
  e.lines.push('%');
}

// ─── Linear Toolpath Emitter ────────────────────────────────────

export function emitFanucGCode(
  toolpath: AnyLinearToolpathResult,
  config?: GCodeConfig,
): string {
  const cfg = resolveConfig(config);
  validateParams(toolpath.params);
  const e = createEmitter(cfg);

  const toolDesc = `${toolpath.tool.name} D${toolpath.tool.diameter} ${toolpath.tool.type.toUpperCase()}`;
  const opName = toolpath.tool.type === 'flat' ? 'CONTOUR PROFILING' : 'BALL NOSE SURFACING';

  let feedInfo: string;
  if ('stepover_pct' in toolpath.params && toolpath.params.stepover_pct) {
    const stepoverMm = toolpath.tool.diameter * (toolpath.params.stepover_pct / 100);
    feedInfo = `STEPOVER: ${e.fmt(stepoverMm)}MM  FEED: ${toolpath.params.feed_rate}MM/MIN  RPM: ${toolpath.params.rpm}`;
  } else {
    feedInfo = `FEED: ${toolpath.params.feed_rate}MM/MIN  RPM: ${toolpath.params.rpm}`;
  }

  emitHeader(e, cfg, opName, toolDesc, toolpath.shape_name, feedInfo, toolpath.params.rpm, toolpath.params.safe_z);

  // ─── Body (with modal optimization) ─────────────────────────

  const plungeRate = toolpath.params.plunge_rate ?? Math.round(toolpath.params.feed_rate / 3);

  let lastG = '';
  let lastX: number | null = null;
  let lastY: number | null = null;
  let lastZ: number | null = null;
  let lastF: number | null = null;

  for (const pt of toolpath.points) {
    // Swap Y↔Z: SDF (x, y, z) → CNC (x=X, z=Y, y=Z)
    const gcX = pt.x;
    const gcY = pt.z;
    const gcZ = pt.y;

    const parts: string[] = [];

    if (pt.type === 'rapid') {
      if (lastG !== 'G00') {
        parts.push('G00');
        lastG = 'G00';
        lastF = null;
      }
    } else {
      if (lastG !== 'G01') {
        parts.push('G01');
        lastG = 'G01';
      }
    }

    if (gcX !== lastX) { parts.push(`X${e.fmt(gcX)}`); lastX = gcX; }
    if (gcY !== lastY) { parts.push(`Y${e.fmt(gcY)}`); lastY = gcY; }
    if (gcZ !== lastZ) { parts.push(`Z${e.fmt(gcZ)}`); lastZ = gcZ; }

    if (pt.type === 'plunge') {
      if (lastF !== plungeRate) { parts.push(`F${plungeRate}`); lastF = plungeRate; }
    } else if (pt.type === 'cut') {
      if (lastF !== toolpath.params.feed_rate) { parts.push(`F${toolpath.params.feed_rate}`); lastF = toolpath.params.feed_rate; }
    }

    if (parts.length > 0) {
      e.emit(parts.join(' '));
    }
  }

  emitFooter(e, cfg);
  return e.lines.join('\n') + '\n';
}

// ─── Drill Cycle Emitter ────────────────────────────────────────

export function emitDrillCycleGCode(
  holes: DrillHole[],
  tool: ToolDefinition,
  params: DrillCycleParams,
  config?: GCodeConfig,
): string {
  const cfg = resolveConfig(config);
  validateParams(params);
  const e = createEmitter(cfg);

  if (holes.length === 0) {
    throw new Error('No holes to emit G-code for.');
  }

  const rClearance = params.r_clearance ?? 2;
  const toolDesc = `${tool.name} D${tool.diameter} DRILL`;
  const opName = params.cycle === 'peck' ? 'PECK DRILL CYCLE' : 'DRILL CYCLE';
  const feedInfo = `FEED: ${params.feed_rate}MM/MIN  RPM: ${params.rpm}`;

  emitHeader(e, cfg, opName, toolDesc, 'drill', feedInfo, params.rpm, params.safe_z);

  // Emit canned cycle for each hole
  // Coordinate swap: SDF (x, y, z) → CNC (X=x, Y=z, Z=y)
  let firstHole = true;

  for (const h of holes) {
    const gcX = h.position[0];
    const gcY = h.position[2]; // SDF Z → CNC Y
    const holeTopZ = h.position[1]; // SDF Y → CNC Z
    const holeBottomZ = holeTopZ - h.depth;
    const rPlane = holeTopZ + rClearance;

    if (firstHole) {
      // Rapid to first hole position
      e.emit(`G00 X${e.fmt(gcX)} Y${e.fmt(gcY)}`);

      if (params.cycle === 'peck') {
        const peckDepth = params.peck_depth ?? tool.diameter * 1.5;
        e.emit(`G83 Z${e.fmt(holeBottomZ)} R${e.fmt(rPlane)} Q${e.fmt(peckDepth)} F${params.feed_rate}`);
      } else {
        e.emit(`G81 Z${e.fmt(holeBottomZ)} R${e.fmt(rPlane)} F${params.feed_rate}`);
      }
      firstHole = false;
    } else {
      // Modal: only emit changed coordinates
      e.emit(`X${e.fmt(gcX)} Y${e.fmt(gcY)}`);
    }
  }

  // Cancel canned cycle
  e.emit(`G80 ${e.comment('CANCEL CANNED CYCLE')}`);

  emitFooter(e, cfg);
  return e.lines.join('\n') + '\n';
}
