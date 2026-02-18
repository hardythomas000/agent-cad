/**
 * CodeMirror 6 editor with Agent CAD custom theme.
 * Supports dark/light mode via Compartment.
 */

import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { getTheme, onThemeChange } from './theme.js';

// ─── Dark theme ───────────────────────────────────────────

const darkTheme = EditorView.theme({
  '&': { backgroundColor: '#18181c', color: '#e0e0e0', height: '100%' },
  '.cm-content': {
    fontFamily: "'JetBrains Mono', monospace", fontSize: '13px',
    lineHeight: '1.6', padding: '12px 0', caretColor: '#c9a84c',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#c9a84c' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(74, 158, 142, 0.2)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(74, 158, 142, 0.05)' },
  '.cm-gutters': {
    backgroundColor: '#18181c', color: '#55534e',
    borderRight: '1px solid #2a2a2e',
    fontFamily: "'JetBrains Mono', monospace", fontSize: '11px',
  },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(74, 158, 142, 0.08)', color: '#4a9e8e' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: true });

const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#4a9e8e' },
  { tag: tags.controlKeyword, color: '#4a9e8e' },
  { tag: tags.definitionKeyword, color: '#4a9e8e' },
  { tag: tags.typeName, color: '#4a9e8e', fontStyle: 'italic' },
  { tag: tags.string, color: '#c9a84c' },
  { tag: tags.number, color: '#b87333' },
  { tag: tags.bool, color: '#b87333' },
  { tag: tags.null, color: '#b87333' },
  { tag: tags.comment, color: '#55534e', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#55534e', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#55534e', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#e0e0e0' },
  { tag: tags.function(tags.variableName), color: '#c9a84c' },
  { tag: tags.definition(tags.variableName), color: '#e0e0e0' },
  { tag: tags.propertyName, color: '#e0e0e0' },
  { tag: tags.operator, color: '#888888' },
  { tag: tags.punctuation, color: '#888888' },
  { tag: tags.paren, color: '#888888' },
  { tag: tags.brace, color: '#888888' },
  { tag: tags.bracket, color: '#888888' },
]);

// ─── Light theme ──────────────────────────────────────────

const lightTheme = EditorView.theme({
  '&': { backgroundColor: '#ffffff', color: '#2a2a2e', height: '100%' },
  '.cm-content': {
    fontFamily: "'JetBrains Mono', monospace", fontSize: '13px',
    lineHeight: '1.6', padding: '12px 0', caretColor: '#9a7a20',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#9a7a20' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(74, 158, 142, 0.15)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(74, 158, 142, 0.06)' },
  '.cm-gutters': {
    backgroundColor: '#f8f8fa', color: '#aaaaae',
    borderRight: '1px solid #e0e0e2',
    fontFamily: "'JetBrains Mono', monospace", fontSize: '11px',
  },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(74, 158, 142, 0.08)', color: '#2a7a6a' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: false });

const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#2a7a6a' },
  { tag: tags.controlKeyword, color: '#2a7a6a' },
  { tag: tags.definitionKeyword, color: '#2a7a6a' },
  { tag: tags.typeName, color: '#2a7a6a', fontStyle: 'italic' },
  { tag: tags.string, color: '#9a7a20' },
  { tag: tags.number, color: '#a06020' },
  { tag: tags.bool, color: '#a06020' },
  { tag: tags.null, color: '#a06020' },
  { tag: tags.comment, color: '#999999', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#999999', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#999999', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#2a2a2e' },
  { tag: tags.function(tags.variableName), color: '#9a7a20' },
  { tag: tags.definition(tags.variableName), color: '#2a2a2e' },
  { tag: tags.propertyName, color: '#2a2a2e' },
  { tag: tags.operator, color: '#666666' },
  { tag: tags.punctuation, color: '#666666' },
  { tag: tags.paren, color: '#666666' },
  { tag: tags.brace, color: '#666666' },
  { tag: tags.bracket, color: '#666666' },
]);

// ─── Default code ─────────────────────────────────────────

const DEFAULT_CODE = `// Agent CAD — live editor
// Edit code below, geometry updates in real-time.

const shape = box(50, 50, 50)

computeMesh(shape, 2.0)
`;

// ─── Init ─────────────────────────────────────────────────

const themeCompartment = new Compartment();

function themeExtensions(mode: 'dark' | 'light') {
  return mode === 'dark'
    ? [darkTheme, syntaxHighlighting(darkHighlight)]
    : [lightTheme, syntaxHighlighting(lightHighlight)];
}

export function initEditor(
  container: HTMLElement,
  onChange?: (code: string) => void,
): EditorView {
  const extensions = [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    javascript({ typescript: true }),
    themeCompartment.of(themeExtensions(getTheme())),
  ];

  if (onChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
    );
  }

  const state = EditorState.create({
    doc: DEFAULT_CODE,
    extensions,
  });

  const view = new EditorView({ state, parent: container });

  // React to theme changes
  onThemeChange((mode) => {
    view.dispatch({
      effects: themeCompartment.reconfigure(themeExtensions(mode)),
    });
  });

  return view;
}
