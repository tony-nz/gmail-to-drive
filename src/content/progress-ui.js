const PANEL_ID = 'gmail-to-drive-progress';

export function showProgressPanel() {
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'gmail-to-drive-progress';
  panel.innerHTML = `
    <div class="gtd-progress-header">
      <span class="gtd-progress-title">Save to Drive</span>
      <button class="gtd-progress-close" aria-label="Close">&times;</button>
    </div>
    <div class="gtd-progress-body">
      <div class="gtd-progress-status">Starting...</div>
      <div class="gtd-progress-bar-container">
        <div class="gtd-progress-bar" style="width: 0%"></div>
      </div>
      <div class="gtd-progress-detail"></div>
    </div>
  `;

  panel.querySelector('.gtd-progress-close').addEventListener('click', () => {
    hideProgressPanel();
  });

  document.body.appendChild(panel);
}

export function updateProgress(current, total, status) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    showProgressPanel();
    return updateProgress(current, total, status);
  }

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  panel.querySelector('.gtd-progress-status').textContent = status;
  panel.querySelector('.gtd-progress-bar').style.width = `${pct}%`;
  panel.querySelector('.gtd-progress-detail').textContent = `${current} of ${total}`;
}

export function showCompletion(results) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const bar = panel.querySelector('.gtd-progress-bar');
  bar.style.width = '100%';

  const statusEl = panel.querySelector('.gtd-progress-status');
  const detailEl = panel.querySelector('.gtd-progress-detail');

  if (results.failed === 0) {
    bar.classList.add('gtd-progress-bar-success');
    statusEl.textContent = `Done! ${results.success} email(s) saved to Drive.`;
    detailEl.textContent = '';
  } else {
    bar.classList.add('gtd-progress-bar-warning');
    statusEl.textContent = `Completed with errors`;
    detailEl.textContent = `${results.success} saved, ${results.failed} failed`;
  }

  setTimeout(() => {
    hideProgressPanel();
  }, 5000);
}

export function showError(error) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    showProgressPanel();
    return showError(error);
  }

  const bar = panel.querySelector('.gtd-progress-bar');
  bar.style.width = '100%';
  bar.classList.add('gtd-progress-bar-error');

  panel.querySelector('.gtd-progress-status').textContent = 'Error';
  panel.querySelector('.gtd-progress-detail').textContent = error;
}

export function hideProgressPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
}
