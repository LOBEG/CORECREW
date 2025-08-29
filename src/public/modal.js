document.addEventListener("DOMContentLoaded", function() {
  // Modal open/close logic
  const openBtn = document.getElementById('quickApplyOpenBtn');
  const modalBg = document.getElementById('quickApplyModalBg');
  const closeBtn = document.getElementById('quickApplyModalClose');
  if (!openBtn || !modalBg || !closeBtn) return;

  openBtn.addEventListener('click', function(e) {
    e.preventDefault();
    modalBg.classList.add('active');
    document.body.style.overflow = 'hidden';
  });

  closeBtn.addEventListener('click', function() {
    modalBg.classList.remove('active');
    document.body.style.overflow = '';
  });

  modalBg.addEventListener('click', function(e) {
    if(e.target === modalBg) {
      modalBg.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // Drag-to-resize logic (optional, if you have a handle)
  const modalContent = document.querySelector('.quick-apply-modal-content');
  const resizeHandle = document.getElementById('modalResizeHandle');
  let isResizing = false;
  let startY, startHeight;

  if (resizeHandle && modalContent) {
    resizeHandle.addEventListener('mousedown', function(e) {
      isResizing = true;
      startY = e.clientY;
      startHeight = modalContent.offsetHeight;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
      if (!isResizing) return;
      let newHeight = startHeight + (e.clientY - startY);
      newHeight = Math.max(200, Math.min(window.innerHeight - 40, newHeight)); // min 200px, max viewport-40px
      modalContent.style.height = newHeight + 'px';
      // Keep max-height so scrolling works!
      modalContent.style.maxHeight = '80vh';
      modalContent.style.overflowY = 'auto';
    });

    document.addEventListener('mouseup', function() {
      if (isResizing) {
        isResizing = false;
        document.body.style.userSelect = '';
      }
    });
  }
});