/**
 * CodeMirror 6 editor with Agent CAD custom theme.
 */

import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** Agent CAD editor theme — dark with teal/gold/copper accents. */
const agentCadTheme = EditorView.theme({
  '&': {
    backgroundColor: '#18181c',
    color: '#e0e0e0',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '13px',
    lineHeight: '1.6',
    padding: '12px 0',
    caretColor: '#c9a84c',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#c9a84c',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(74, 158, 142, 0.2)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(74, 158, 142, 0.05)',
  },
  '.cm-gutters': {
    backgroundColor: '#18181c',
    color: '#55534e',
    borderRight: '1px solid #2a2a2e',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(74, 158, 142, 0.08)',
    color: '#4a9e8e',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
}, { dark: true });

/** Syntax highlighting — teal keywords, gold strings, copper numbers. */
const agentCadHighlight = HighlightStyle.define([
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

/** Example DSL code shown by default. */
const DEFAULT_CODE = `// Agent CAD — bracket demo
// This is the geometry Claude authored via MCP tools.

const stock = box(150, 80, 40)

// Cut a pocket from the top face
const pocket = box(120, 60, 25)
  .translate(0, 0, 7.5)

const withPocket = stock.subtract(pocket)

// Add two through-holes
const hole1 = cylinder(5, 50)
  .translate(-30, 0, 0)

const hole2 = cylinder(5, 50)
  .translate(30, 0, 0)

const bracket = withPocket
  .subtract(hole1)
  .subtract(hole2)
  .round(2)

// Export
computeMesh(bracket, 1.0)
exportSTL(bracket, "bracket.stl")
`;

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
    agentCadTheme,
    syntaxHighlighting(agentCadHighlight),
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

  return new EditorView({
    state,
    parent: container,
  });
}
