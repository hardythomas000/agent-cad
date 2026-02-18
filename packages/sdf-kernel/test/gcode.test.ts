import { describe, it, expect } from 'vitest';
import { box } from '../src/api.js';
import { generateRasterSurfacing } from '../src/toolpath.js';
import { emitFanucGCode } from '../src/gcode.js';
import type { ToolDefinition, ToolpathResult } from '../src/toolpath.js';

function makeTool(diameter: number): ToolDefinition {
  return { name: 'T1', type: 'ballnose', diameter, radius: diameter / 2 };
}

function makeToolpath(): ToolpathResult {
  const shape = box(100, 60, 30);
  const tool = makeTool(10);
  const result = generateRasterSurfacing(shape, tool, {
    direction: 'x',
    stepover_pct: 50,
    point_spacing: 20, // Coarse for fast test
    feed_rate: 2000,
    rpm: 10000,
    safe_z: 50,
    zigzag: true,
  });
  return { ...result, id: 'tp_test' };
}

describe('emitFanucGCode', () => {

  it('produces valid G-code with header and footer', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp);

    expect(gcode).toContain('%');
    expect(gcode).toContain('O1001');
    expect(gcode).toContain('G90 G21 G17');
    expect(gcode).toContain('M03 S10000');
    expect(gcode).toContain('M05');
    expect(gcode).toContain('M30');
    expect(gcode).toContain('G00 G53 Z0.');
  });

  it('includes tool and shape info in comments', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp);

    expect(gcode).toContain('BALL NOSE SURFACING');
    expect(gcode).toContain('T1');
    expect(gcode).toContain('D10');
    expect(gcode).toContain('AGENT-CAD');
  });

  it('uses G00 for rapids and G01 for cuts', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp);
    const lines = gcode.split('\n');

    // Should have both G00 and G01 lines
    expect(lines.some(l => l.includes('G00'))).toBe(true);
    expect(lines.some(l => l.includes('G01'))).toBe(true);
  });

  it('modal optimization omits unchanged G-codes', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp);
    const lines = gcode.split('\n');

    // Count lines with explicit G01 — should be fewer than total G01 cutting lines
    // because G01 stays modal
    const g01Lines = lines.filter(l => l.includes('G01'));
    const cuttingLines = lines.filter(l => l.match(/^[NX]/)); // Lines starting with coord

    // Modal optimization means many cutting lines won't have explicit G01
    // As long as we have SOME lines without G01 that are cutting moves
    const linesWithoutG = lines.filter(l =>
      !l.includes('G') && !l.startsWith('%') && !l.startsWith('(') &&
      l.trim().length > 0 && (l.includes('X') || l.includes('Y') || l.includes('Z'))
    );
    // Modal optimization should produce at least some G-code-less coordinate lines
    expect(linesWithoutG.length).toBeGreaterThan(0);
  });

  it('feed rate emitted on change', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp);

    // Should have plunge rate (2000/3 ≈ 667)
    expect(gcode).toContain('F667');
    // Should have cutting rate
    expect(gcode).toContain('F2000');
  });

  it('custom program number', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp, { program_number: 5555 });
    expect(gcode).toContain('O5555');
  });

  it('custom work offset', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp, { work_offset: 'G55' });
    expect(gcode).toContain('G55');
  });

  it('coolant off skips M08/M07', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp, { coolant: 'off' });
    expect(gcode).not.toContain('M08');
    expect(gcode).not.toContain('M07');
    // M09 also skipped
    expect(gcode).not.toContain('M09');
  });

  it('mist coolant uses M07', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp, { coolant: 'mist' });
    expect(gcode).toContain('M07');
  });

  it('line numbers when enabled', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp, { line_numbers: true });
    const lines = gcode.split('\n').filter(l => l.startsWith('N'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/^N10 /);
  });

  it('starts and ends with %', () => {
    const tp = makeToolpath();
    const gcode = emitFanucGCode(tp);
    const lines = gcode.trim().split('\n');
    expect(lines[0]).toBe('%');
    expect(lines[lines.length - 1]).toBe('%');
  });
});
