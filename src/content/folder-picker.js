const PICKER_ID = 'gmail-to-drive-picker';

let pickerCallback = null;
let navStack = [];
let currentFolderId = 'root';
let currentFolderName = 'My Drive';
let currentDriveId = null;

export function showFolderPicker(emailCount, onSelect) {
  closePicker();
  pickerCallback = onSelect;
  navStack = [];
  currentFolderId = 'root';
  currentFolderName = 'My Drive';
  currentDriveId = null;

  const overlay = document.createElement('div');
  overlay.id = PICKER_ID;
  overlay.className = 'gtd-picker-overlay';
  overlay.innerHTML = `
    <div class="gtd-picker">
      <div class="gtd-picker-header">
        <span>Save ${emailCount} email(s) to Google Drive</span>
        <button class="gtd-picker-close">&times;</button>
      </div>
      <div class="gtd-picker-tabs">
        <button class="gtd-picker-tab active" data-tab="my-drive">My Drive</button>
        <button class="gtd-picker-tab" data-tab="shared">Shared Drives</button>
      </div>
      <div class="gtd-picker-nav">
        <button class="gtd-picker-back" disabled>&larr;</button>
        <span class="gtd-picker-path">My Drive</span>
      </div>
      <div class="gtd-picker-list">
        <div class="gtd-picker-loading">Loading...</div>
      </div>
      <div class="gtd-picker-footer">
        <div class="gtd-picker-footer-left">
          <button class="gtd-picker-new-folder">+ New Folder</button>
        </div>
        <div class="gtd-picker-footer-right">
          <button class="gtd-picker-cancel">Cancel</button>
          <button class="gtd-picker-select">Save Here</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.gtd-picker-close').addEventListener('click', closePicker);
  overlay.querySelector('.gtd-picker-cancel').addEventListener('click', closePicker);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePicker();
  });

  overlay.querySelector('.gtd-picker-back').addEventListener('click', handleBack);
  overlay.querySelector('.gtd-picker-select').addEventListener('click', handleSelect);
  overlay.querySelector('.gtd-picker-new-folder').addEventListener('click', handleNewFolder);

  overlay.querySelectorAll('.gtd-picker-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  loadFolders('root', null);
}

function closePicker() {
  const el = document.getElementById(PICKER_ID);
  if (el) el.remove();
  pickerCallback = null;
}

function switchTab(tab) {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;

  picker.querySelectorAll('.gtd-picker-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  navStack = [];
  currentDriveId = null;
  picker.querySelector('.gtd-picker-back').disabled = true;

  if (tab === 'my-drive') {
    currentFolderId = 'root';
    currentFolderName = 'My Drive';
    picker.querySelector('.gtd-picker-path').textContent = 'My Drive';
    loadFolders('root', null);
  } else {
    currentFolderId = null;
    currentFolderName = 'Shared Drives';
    picker.querySelector('.gtd-picker-path').textContent = 'Shared Drives';
    loadSharedDrives();
  }
}

function loadSharedDrives() {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
  const list = picker.querySelector('.gtd-picker-list');
  list.innerHTML = '<div class="gtd-picker-loading">Loading shared drives...</div>';

  chrome.runtime.sendMessage({ action: 'LIST_SHARED_DRIVES' }, (response) => {
    if (response?.error) {
      list.innerHTML = `<div class="gtd-picker-empty">Error: ${response.error}</div>`;
      return;
    }
    const drives = response?.drives || [];
    if (drives.length === 0) {
      list.innerHTML = '<div class="gtd-picker-empty">No shared drives found</div>';
      return;
    }
    list.innerHTML = '';
    drives.forEach((drive) => {
      const item = createItem(drive.name, 'shared-drive');
      item.addEventListener('click', () => {
        navStack.push({ id: null, name: 'Shared Drives', driveId: null, type: 'drives-list' });
        currentDriveId = drive.id;
        currentFolderId = drive.id;
        currentFolderName = drive.name;
        updateNav();
        loadFolders(drive.id, drive.id);
      });
      list.appendChild(item);
    });
  });
}

function loadFolders(parentId, driveId) {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
  const list = picker.querySelector('.gtd-picker-list');
  list.innerHTML = '<div class="gtd-picker-loading">Loading...</div>';

  chrome.runtime.sendMessage({ action: 'LIST_FOLDERS', parentId, driveId }, (response) => {
    if (response?.error) {
      list.innerHTML = `<div class="gtd-picker-empty">Error: ${response.error}</div>`;
      return;
    }
    const folders = response?.folders || [];
    if (folders.length === 0) {
      list.innerHTML = '<div class="gtd-picker-empty">No subfolders — click "Save Here" to use this folder</div>';
      return;
    }
    list.innerHTML = '';
    folders.forEach((folder) => {
      const item = createItem(folder.name, 'folder');
      item.addEventListener('click', () => {
        navStack.push({ id: currentFolderId, name: currentFolderName, driveId: currentDriveId, type: 'folder' });
        currentFolderId = folder.id;
        currentFolderName = folder.name;
        updateNav();
        loadFolders(folder.id, currentDriveId);
      });
      list.appendChild(item);
    });
  });
}

function createItem(name, type) {
  const item = document.createElement('div');
  item.className = 'gtd-picker-item';
  const icon = type === 'shared-drive'
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368"><path d="M19 13H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2zM5 3c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H5z"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="#5f6368"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
  item.innerHTML = `
    <span class="gtd-picker-item-icon">${icon}</span>
    <span class="gtd-picker-item-name">${escapeHtml(name)}</span>
    <span class="gtd-picker-item-arrow">&rsaquo;</span>
  `;
  return item;
}

function updateNav() {
  const picker = document.getElementById(PICKER_ID);
  if (!picker) return;
  picker.querySelector('.gtd-picker-back').disabled = navStack.length === 0;
  picker.querySelector('.gtd-picker-path').textContent = buildPath();
}

function buildPath() {
  const parts = [];
  if (!currentDriveId) {
    parts.push('My Drive');
  }
  for (const entry of navStack) {
    if (entry.type !== 'drives-list') {
      parts.push(entry.name);
    }
  }
  parts.push(currentFolderName);
  return parts.join(' / ');
}

function handleBack() {
  if (navStack.length === 0) return;
  const prev = navStack.pop();

  if (prev.type === 'drives-list') {
    currentDriveId = null;
    currentFolderId = null;
    currentFolderName = 'Shared Drives';
    updateNav();
    loadSharedDrives();
  } else {
    currentFolderId = prev.id;
    currentFolderName = prev.name;
    currentDriveId = prev.driveId;
    updateNav();
    loadFolders(prev.id, prev.driveId);
  }
}

function handleSelect() {
  if (!pickerCallback) return;
  const destination = {
    folderId: currentFolderId,
    folderName: currentFolderName,
    driveId: currentDriveId,
    path: buildPath(),
  };
  const cb = pickerCallback;
  closePicker();
  cb(destination);
}

function handleNewFolder() {
  const name = prompt('New folder name:');
  if (!name || !name.trim()) return;

  chrome.runtime.sendMessage(
    {
      action: 'CREATE_FOLDER',
      name: name.trim(),
      parentId: currentFolderId || 'root',
      driveId: currentDriveId,
    },
    (response) => {
      if (response?.error) {
        alert('Failed to create folder: ' + response.error);
        return;
      }
      // Navigate into the new folder
      navStack.push({ id: currentFolderId, name: currentFolderName, driveId: currentDriveId, type: 'folder' });
      currentFolderId = response.folder.id;
      currentFolderName = response.folder.name;
      updateNav();
      loadFolders(response.folder.id, currentDriveId);
    }
  );
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
