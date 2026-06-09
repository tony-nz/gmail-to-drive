import { waitForGmailReady, injectButton, getSelectedThreadIds, observeToolbarChanges } from './gmail-dom.js';
import { showProgressPanel, updateProgress, showCompletion, showError } from './progress-ui.js';
import { showFolderPicker } from './folder-picker.js';

async function init() {
  await waitForGmailReady();
  setupButton();
  observeToolbarChanges(setupButton);
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

  chrome.runtime.sendMessage(
    { action: 'RESOLVE_THREAD_IDS', candidateIds },
    (response) => {
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

        chrome.runtime.sendMessage({
          action: 'SAVE_TO_DRIVE',
          threadIds,
          destination: selectedFolder,
        });
      });
    }
  );
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
