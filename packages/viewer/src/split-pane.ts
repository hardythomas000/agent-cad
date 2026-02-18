/**
 * Resizable split-pane layout.
 */

export function initSplitPane(
  editorPane: HTMLElement,
  divider: HTMLElement,
  onResize?: () => void,
): void {
  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  divider.addEventListener('mousedown', (e: MouseEvent) => {
    isDragging = true;
    startX = e.clientX;
    startWidth = editorPane.getBoundingClientRect().width;
    divider.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const newWidth = Math.max(150, Math.min(startWidth + dx, window.innerWidth - 200));
    editorPane.style.flex = `0 0 ${newWidth}px`;
    onResize?.();
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    divider.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    onResize?.();
  });
}
