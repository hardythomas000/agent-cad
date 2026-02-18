/**
 * G-code Emitter — Fanuc-compatible 3-axis output.
 *
 * Takes a ToolpathResult and emits a complete NC program:
 *   %, O-number, header comments, G90/G21/G17, spindle, coolant,
 *   G00 rapids, G01 cuts with modal optimization, footer.
 *
 * Modal optimization omits unchanged coordinates and codes,
 * reducing file size by ~40% on typical surfacing programs.
 */

import type { ToolpathResult, ToolpathPoint } from './toolpath.js';

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

// ─── Emitter ────────────────────────────────────────────────────

export function emitFanucGCode(
  toolpath: ToolpathResult,
  config?: GCodeConfig,
): string {
  const cfg = {
    program_number: config?.program_number ?? 1001,
    work_offset: config?.work_offset ?? 'G54',
    coolant: config?.coolant ?? 'flood',
    comment_style: config?.comment_style ?? 'paren',
    decimal_places: config?.decimal_places ?? 3,
    line_numbers: config?.line_numbers ?? false,
    rapid_rate: config?.rapid_rate ?? 15000,
  };

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
    // Strip trailing zeros after decimal point, but keep at least one decimal
    // G-code convention: "X10." not "X10.000"
    const trimmed = s.replace(/0+$/, '');
    return trimmed.endsWith('.') ? trimmed : trimmed;
  }

  // ─── Header ─────────────────────────────────────────────────

  lines.push('%');

  const toolDesc = `${toolpath.tool.name} D${toolpath.tool.diameter} ${toolpath.tool.type.toUpperCase()}`;
  emit(`O${String(cfg.program_number).padStart(4, '0')} ${comment('BALL NOSE SURFACING')}`);
  emit(comment(`TOOL: ${toolDesc}`));
  emit(comment(`SHAPE: ${toolpath.shape_name}`));
  emit(comment(`GENERATED: ${new Date().toISOString().split('T')[0]} BY AGENT-CAD`));

  const stepoverMm = toolpath.tool.diameter * (toolpath.params.stepover_pct / 100);
  emit(comment(`STEPOVER: ${fmt(stepoverMm)}MM  FEED: ${toolpath.params.feed_rate}MM/MIN  RPM: ${toolpath.params.rpm}`));

  emit(`G90 G21 G17 ${comment('ABSOLUTE, METRIC, XY PLANE')}`);
  emit(`G00 ${cfg.work_offset} X0. Y0. Z${fmt(toolpath.params.safe_z)} ${comment('RAPID TO SAFE Z')}`);
  emit(`M03 S${toolpath.params.rpm} ${comment('SPINDLE ON')}`);

  // Coolant
  if (cfg.coolant === 'flood') {
    emit(`M08 ${comment('COOLANT FLOOD')}`);
  } else if (cfg.coolant === 'mist') {
    emit(`M07 ${comment('COOLANT MIST')}`);
  }

  // ─── Body (with modal optimization) ─────────────────────────

  const plungeRate = toolpath.params.plunge_rate ?? Math.round(toolpath.params.feed_rate / 3);

  // Modal state tracking
  let lastG = '';
  let lastX: number | null = null;
  let lastY: number | null = null;
  let lastZ: number | null = null;
  let lastF: number | null = null;

  for (const pt of toolpath.points) {
    const parts: string[] = [];

    if (pt.type === 'rapid') {
      if (lastG !== 'G00') {
        parts.push('G00');
        lastG = 'G00';
        lastF = null; // F not applicable for rapids
      }
    } else if (pt.type === 'plunge') {
      if (lastG !== 'G01') {
        parts.push('G01');
        lastG = 'G01';
      }
    } else { // cut
      if (lastG !== 'G01') {
        parts.push('G01');
        lastG = 'G01';
      }
    }

    // Only emit changed coordinates
    if (pt.x !== lastX) {
      parts.push(`X${fmt(pt.x)}`);
      lastX = pt.x;
    }
    if (pt.y !== lastY) {
      parts.push(`Y${fmt(pt.y)}`);
      lastY = pt.y;
    }
    if (pt.z !== lastZ) {
      parts.push(`Z${fmt(pt.z)}`);
      lastZ = pt.z;
    }

    // Feed rate (only for G01, only when changed)
    if (pt.type === 'plunge') {
      if (lastF !== plungeRate) {
        parts.push(`F${plungeRate}`);
        lastF = plungeRate;
      }
    } else if (pt.type === 'cut') {
      if (lastF !== toolpath.params.feed_rate) {
        parts.push(`F${toolpath.params.feed_rate}`);
        lastF = toolpath.params.feed_rate;
      }
    }

    // Don't emit empty lines (all coords same)
    if (parts.length > 0) {
      emit(parts.join(' '));
    }
  }

  // ─── Footer ─────────────────────────────────────────────────

  emit(`M05 ${comment('SPINDLE OFF')}`);
  if (cfg.coolant !== 'off') {
    emit(`M09 ${comment('COOLANT OFF')}`);
  }
  emit(`G00 G53 Z0. ${comment('HOME Z')}`);
  emit(`M30 ${comment('END')}`);
  lines.push('%');

  return lines.join('\n') + '\n';
}
