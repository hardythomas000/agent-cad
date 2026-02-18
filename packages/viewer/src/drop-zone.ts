/**
 * Drag-and-drop + file picker for STL loading.
 */

export function initDropZone(
  viewportPane: HTMLElement,
  overlay: HTMLElement,
  fileInput: HTMLInputElement,
  onFile: (file: File) => void,
): void {
  let dragCounter = 0;

  viewportPane.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.add('visible');
  });

  viewportPane.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  viewportPane.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay.classList.remove('visible');
    }
  });

  viewportPane.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('visible');
    const file = e.dataTransfer?.files[0];
    if (file && file.name.toLowerCase().endsWith('.stl')) {
      onFile(file);
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      onFile(file);
      fileInput.value = '';
    }
  });
}
