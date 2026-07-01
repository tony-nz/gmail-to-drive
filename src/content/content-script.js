import { waitForGmailReady, injectButton, getSelectedThreadIds, observeToolbarChanges } from './gmail-dom.js';
import { showProgressPanel, updateProgress, showCompletion, showError } from './progress-ui.js';
import { showFolderPicker } from './folder-picker.js';

// Shared handle on the page window so a freshly injected instance (e.g. after an
// extension update re-injects us via chrome.scripting) can clean up the previous
// instance's observer and button before taking over. This keeps the button
// working across updates without ever reloading the tab.
const GTD = (window.__gmailToDrive = window.__gmailToDrive || {});

// True while our extension context is still valid. Once the extension is
// reloaded/updated, any chrome.runtime.* call from this (now orphaned) script
// throws "Extension context invalidated". A fresh instance will be injected to
// replace us, but guard against clicks that land in the gap.
function extensionAlive() {
  return !!(chrome.runtime && chrome.runtime.id);
}

// Disconnect a previous instance's observer and remove its (possibly orphaned)
// button so we never end up with a duplicate or a dead button.
function teardownPrevious() {
  if (GTD.observer) {
    try { GTD.observer.disconnect(); } catch (_) { /* already gone */ }
    GTD.observer = null;
  }
  const stale = document.getElementById('gmail-to-drive-btn');
  if (stale) stale.remove();
}

async function init() {
  teardownPrevious();
  await waitForGmailReady();
  setupButton();
  GTD.observer = observeToolbarChanges(setupButton);
}

function setupButton() {
  const button = injectButton();
  if (!button) return;

  button.addEventListener('click', handleSaveClick);
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSaveClick();
    }
  });
}

function handleSaveClick() {
  if (!extensionAlive()) {
    showProgressPanel();
    showError('Gmail2Drive was just updated. Please try again in a moment.');
    return;
  }

  const candidateIds = getSelectedThreadIds();
  console.log('[GTD Content] Selected IDs from DOM:', candidateIds);

  if (candidateIds.length === 0) {
    showProgressPanel();
    showError('No emails selected. Please select emails using the checkboxes.');
    return;
  }

  if (candidateIds.length > 50) {
    showProgressPanel();
    showError(`Too many emails selected (${candidateIds.length}). Please select 50 or fewer.`);
    return;
  }

  // Resolve DOM IDs to real API thread IDs before showing the picker
  showProgressPanel();
  updateProgress(0, candidateIds.length, 'Resolving selected emails...');

  try {
    chrome.runtime.sendMessage(
    { action: 'RESOLVE_THREAD_IDS', candidateIds },
    (response) => {
      if (chrome.runtime.lastError) {
        showError('Gmail2Drive was just updated. Please try again in a moment.');
        return;
      }
      if (response?.error) {
        showError(`Failed to resolve emails: ${response.error}`);
        return;
      }

      const threadIds = response?.resolvedIds || [];
      console.log('[GTD Content] Resolved thread IDs:', threadIds);

      if (threadIds.length === 0) {
        showError('Could not identify the selected emails. Try selecting them again.');
        return;
      }

      // Hide progress, show folder picker
      const progressPanel = document.getElementById('gmail-to-drive-progress');
      if (progressPanel) progressPanel.remove();

      showFolderPicker(threadIds.length, (selectedFolder) => {
        showProgressPanel();
        updateProgress(0, threadIds.length, 'Starting...');

        if (!extensionAlive()) {
          showError('Gmail2Drive was just updated. Please try again in a moment.');
          return;
        }

        try {
          chrome.runtime.sendMessage({
            action: 'SAVE_TO_DRIVE',
            threadIds,
            destination: selectedFolder,
          });
        } catch (_) {
          showError('Gmail2Drive was just updated. Please try again in a moment.');
        }
      });
    }
  );
  } catch (_) {
    showError('Gmail2Drive was just updated. Please try again in a moment.');
  }
}

chrome.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case 'SAVE_PROGRESS':
      updateProgress(message.current, message.total, message.status);
      break;

    case 'SAVE_COMPLETE':
      showCompletion(message.results);
      break;

    case 'SAVE_ERROR':
      showError(message.error);
      break;
  }
});

init();
