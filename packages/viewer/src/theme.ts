/**
 * Agent CAD aesthetic — colors and fonts from VISION.md.
 */

export const COLORS = {
  bg: '#0a0a0c',
  panelBg: '#18181c',
  panelBorder: '#2a2a2e',
  wireframe: 'rgba(74, 158, 142, 0.15)',
  wireframeSolid: '#4a9e8e',
  geometry: '#c9a84c',
  normals: '#b87333',
  codeKeyword: '#4a9e8e',
  codeString: '#c9a84c',
  codeNumber: '#b87333',
  codeComment: '#55534e',
  text: '#e0e0e0',
  textDim: '#888888',
  accent: '#4a9e8e',
} as const;

/** Three.js-compatible hex integers */
export const HEX = {
  bg: 0x0a0a0c,
  panelBg: 0x18181c,
  geometry: 0xc9a84c,
  normals: 0xb87333,
  wireframe: 0x4a9e8e,
  grid: 0x4a9e8e,
  keyLight: 0xfff4e0,
  fillLight: 0x4a9e8e,
  rimLight: 0xb87333,
  ambient: 0x333340,
} as const;

export const FONTS = {
  heading: "'DM Serif Display', serif",
  body: "'Source Serif 4', serif",
  code: "'JetBrains Mono', monospace",
} as const;
