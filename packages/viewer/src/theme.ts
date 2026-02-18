/**
 * Agent CAD aesthetic — colors and fonts from VISION.md.
 * Supports dark and light themes.
 */

export type ThemeMode = 'dark' | 'light';

let currentMode: ThemeMode = 'dark';
const listeners: Array<(mode: ThemeMode) => void> = [];

// Restore saved theme
const saved = localStorage.getItem('agent-cad-theme');
if (saved === 'light' || saved === 'dark') currentMode = saved;

export function getTheme(): ThemeMode { return currentMode; }

export function setTheme(mode: ThemeMode): void {
  currentMode = mode;
  localStorage.setItem('agent-cad-theme', mode);
  Object.assign(HEX, mode === 'dark' ? DARK_HEX : LIGHT_HEX);
  listeners.forEach(fn => fn(mode));
}

export function onThemeChange(fn: (mode: ThemeMode) => void): void {
  listeners.push(fn);
}

const DARK_HEX = {
  bg: 0x0a0a0c,
  panelBg: 0x18181c,
  geometry: 0xc9a84c,
  normals: 0xb87333,
  wireframe: 0x4a9e8e,
  grid: 0x4a9e8e,
  gridOpacity: 0.12,
  keyLight: 0xfff4e0,
  fillLight: 0x4a9e8e,
  rimLight: 0xb87333,
  ambient: 0x333340,
} as const;

const LIGHT_HEX = {
  bg: 0xf0f0f2,
  panelBg: 0xffffff,
  geometry: 0xb8942e,
  normals: 0xa06020,
  wireframe: 0x2a7a6a,
  grid: 0x999999,
  gridOpacity: 0.25,
  keyLight: 0xfff4e0,
  fillLight: 0x4a9e8e,
  rimLight: 0xb87333,
  ambient: 0x888890,
} as const;

/** Mutable hex colors — updated by setTheme(). All consumers see current values. */
export const HEX: Record<string, number> = { ...(currentMode === 'dark' ? DARK_HEX : LIGHT_HEX) };

export const FONTS = {
  heading: "'DM Serif Display', serif",
  body: "'Source Serif 4', serif",
  code: "'JetBrains Mono', monospace",
} as const;
