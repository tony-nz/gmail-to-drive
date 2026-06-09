document.addEventListener('DOMContentLoaded', () => {
  const createDateFolders = document.getElementById('create-date-folders');
  const exportAllMessages = document.getElementById('export-all-messages');
  const btnSave = document.getElementById('btn-save');
  const saveStatus = document.getElementById('save-status');
  const locationText = document.getElementById('location-text');
  const btnChangeFolder = document.getElementById('btn-change-folder');

  const folderBrowser = document.getElementById('folder-browser');
  const browserList = document.getElementById('browser-list');
  const browserPath = document.getElementById('browser-path');
  const btnBrowserBack = document.getElementById('btn-browser-back');
  const btnBrowserClose = document.getElementById('btn-browser-close');
  const btnSelectFolder = document.getElementById('btn-select-folder');
  const btnNewFolder = document.getElementById('btn-new-folder');
  const tabMyDrive = document.getElementById('tab-my-drive');
  const tabShared = document.getElementById('tab-shared');

  let currentSettings = {};
  let navStack = [];
  let currentFolderId = null;
  let currentFolderName = 'My Drive';
  let currentDriveId = null;
  let activeTab = 'my-drive';

  loadSettings();

  function loadSettings() {
    chrome.storage.sync.get(
      {
        destinationFolderId: null,
        destinationFolderName: null,
        destinationPath: 'My Drive (root)',
        driveId: null,
        driveName: null,
        createDateFolders: true,
        exportAllMessages: true,
      },
      (settings) => {
        currentSettings = settings;
        createDateFolders.checked = settings.createDateFolders;
        exportAllMessages.checked = settings.exportAllMessages;
        locationText.textContent = settings.destinationPath || 'My Drive (root)';
      }
    );
  }

  btnChangeFolder.addEventListener('click', () => {
    folderBrowser.style.display = 'block';
    navStack = [];
    currentDriveId = null;
    switchTab('my-drive');
  });

  btnBrowserClose.addEventListener('click', () => {
    folderBrowser.style.display = 'none';
  });

  tabMyDrive.addEventListener('click', () => switchTab('my-drive'));
  tabShared.addEventListener('click', () => switchTab('shared'));

  function switchTab(tab) {
    activeTab = tab;
    tabMyDrive.classList.toggle('active', tab === 'my-drive');
    tabShared.classList.toggle('active', tab === 'shared');
    navStack = [];
    currentDriveId = null;
    btnBrowserBack.disabled = true;

    if (tab === 'my-drive') {
      currentFolderId = 'root';
      currentFolderName = 'My Drive';
      browserPath.textContent = 'My Drive';
      loadFolders('root', null);
    } else {
      currentFolderId = null;
      currentFolderName = 'Shared Drives';
      browserPath.textContent = 'Shared Drives';
      loadSharedDrives();
    }
  }

  function loadSharedDrives() {
    browserList.innerHTML = '<div class="browser-loading">Loading shared drives...</div>';

    chrome.runtime.sendMessage({ action: 'LIST_SHARED_DRIVES' }, (response) => {
      if (response?.error) {
        browserList.innerHTML = `<div class="browser-empty">Error: ${response.error}</div>`;
        return;
      }

      const drives = response?.drives || [];
      if (drives.length === 0) {
        browserList.innerHTML = '<div class="browser-empty">No shared drives found</div>';
        return;
      }

      browserList.innerHTML = '';
      drives.forEach((drive) => {
        const item = createBrowserItem(drive.name, '🔗');
        item.addEventListener('click', () => {
          navStack.push({ id: null, name: 'Shared Drives', driveId: null, type: 'drives-list' });
          currentDriveId = drive.id;
          currentFolderId = drive.id;
          currentFolderName = drive.name;
          browserPath.textContent = drive.name;
          btnBrowserBack.disabled = false;
          loadFolders(drive.id, drive.id);
        });
        browserList.appendChild(item);
      });
    });
  }

  function loadFolders(parentId, driveId) {
    browserList.innerHTML = '<div class="browser-loading">Loading folders...</div>';

    chrome.runtime.sendMessage(
      { action: 'LIST_FOLDERS', parentId, driveId },
      (response) => {
        if (response?.error) {
          browserList.innerHTML = `<div class="browser-empty">Error: ${response.error}</div>`;
          return;
        }

        const folders = response?.folders || [];
        if (folders.length === 0) {
          browserList.innerHTML = '<div class="browser-empty">No subfolders</div>';
          return;
        }

        browserList.innerHTML = '';
        folders.forEach((folder) => {
          const item = createBrowserItem(folder.name, '📁');
          item.addEventListener('click', () => {
            navStack.push({
              id: currentFolderId,
              name: currentFolderName,
              driveId: currentDriveId,
              type: 'folder',
            });
            currentFolderId = folder.id;
            currentFolderName = folder.name;
            browserPath.textContent = buildPathDisplay();
            btnBrowserBack.disabled = false;
            loadFolders(folder.id, currentDriveId);
          });
          browserList.appendChild(item);
        });
      }
    );
  }

  function createBrowserItem(name, icon) {
    const item = document.createElement('div');
    item.className = 'browser-item';
    item.innerHTML = `
      <span class="browser-item-icon">${icon}</span>
      <span class="browser-item-name">${escapeHtml(name)}</span>
    `;
    return item;
  }

  btnBrowserBack.addEventListener('click', () => {
    if (navStack.length === 0) return;

    const prev = navStack.pop();
    btnBrowserBack.disabled = navStack.length === 0;

    if (prev.type === 'drives-list') {
      currentDriveId = null;
      currentFolderId = null;
      currentFolderName = 'Shared Drives';
      browserPath.textContent = 'Shared Drives';
      loadSharedDrives();
    } else {
      currentFolderId = prev.id;
      currentFolderName = prev.name;
      currentDriveId = prev.driveId;
      browserPath.textContent = buildPathDisplay();
      loadFolders(prev.id, prev.driveId);
    }
  });

  btnSelectFolder.addEventListener('click', () => {
    if (!currentFolderId) return;

    const path = buildPathDisplay();
    currentSettings.destinationFolderId = currentFolderId;
    currentSettings.destinationFolderName = currentFolderName;
    currentSettings.destinationPath = path;
    currentSettings.driveId = currentDriveId;

    locationText.textContent = path;
    folderBrowser.style.display = 'none';
  });

  btnNewFolder.addEventListener('click', () => {
    const name = prompt('New folder name:');
    if (!name || !name.trim()) return;

    const parentId = currentFolderId || 'root';

    chrome.runtime.sendMessage(
      { action: 'LIST_FOLDERS', parentId, driveId: currentDriveId },
      () => {
        // Trigger folder creation via service worker
        chrome.runtime.sendMessage(
          {
            action: 'CREATE_FOLDER',
            name: name.trim(),
            parentId,
            driveId: currentDriveId,
          },
          (response) => {
            if (response?.error) {
              alert('Failed to create folder: ' + response.error);
              return;
            }
            loadFolders(parentId, currentDriveId);
          }
        );
      }
    );
  });

  function buildPathDisplay() {
    const parts = [];
    if (currentDriveId) {
      const driveName = navStack.find((s) => s.type === 'drives-list')
        ? navStack[navStack.length - 1]?.name
        : '';
      for (const entry of navStack) {
        if (entry.type !== 'drives-list') {
          parts.push(entry.name);
        }
      }
    } else {
      parts.push('My Drive');
      for (const entry of navStack) {
        parts.push(entry.name);
      }
    }
    parts.push(currentFolderName);
    return parts.join(' / ');
  }

  btnSave.addEventListener('click', () => {
    const settings = {
      ...currentSettings,
      createDateFolders: createDateFolders.checked,
      exportAllMessages: exportAllMessages.checked,
    };

    chrome.storage.sync.set(settings, () => {
      saveStatus.textContent = 'Settings saved!';
      setTimeout(() => {
        saveStatus.textContent = '';
      }, 2000);
    });
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
