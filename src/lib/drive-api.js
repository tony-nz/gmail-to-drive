const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function apiRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Drive API error ${response.status}: ${error.error?.message || response.statusText}`);
  }

  return response.json();
}

export async function findFolder(name, parentId, token) {
  const q = parentId
    ? `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${name}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const data = await apiRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    token
  );

  return data.files?.[0] || null;
}

export async function createFolder(name, parentId, token) {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentId) {
    metadata.parents = [parentId];
  }

  return apiRequest(`${DRIVE_API}/files`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
}

export async function findOrCreateFolder(name, parentId, token) {
  const existing = await findFolder(name, parentId, token);
  if (existing) return existing;
  return createFolder(name, parentId, token);
}

export async function ensureFolderPath(rootName, datePath, emailName, token) {
  const root = await findOrCreateFolder(rootName, null, token);
  const dateFolder = await findOrCreateFolder(datePath, root.id, token);
  const emailFolder = await findOrCreateFolder(emailName, dateFolder.id, token);
  return emailFolder;
}

export async function uploadFile(name, mimeType, content, parentId, token) {
  const metadata = {
    name,
    parents: [parentId],
  };

  const MULTIPART_BOUNDARY = 'gmail_to_drive_boundary';

  let contentBase64;
  if (content instanceof Uint8Array || content instanceof ArrayBuffer) {
    const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : content;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    contentBase64 = btoa(binary);
  } else if (typeof content === 'string') {
    contentBase64 = btoa(unescape(encodeURIComponent(content)));
  } else {
    throw new Error('Unsupported content type for upload');
  }

  const body = [
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${MULTIPART_BOUNDARY}`,
    `Content-Type: ${mimeType}`,
    'Content-Transfer-Encoding: base64',
    '',
    contentBase64,
    `--${MULTIPART_BOUNDARY}--`,
  ].join('\r\n');

  return apiRequest(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink`,
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
      },
      body,
    }
  );
}

export async function uploadFileResumable(name, mimeType, content, parentId, token) {
  const metadata = {
    name,
    parents: [parentId],
  };

  const initResponse = await fetch(`${UPLOAD_API}/files?uploadType=resumable`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': content.byteLength || content.length,
    },
    body: JSON.stringify(metadata),
  });

  if (!initResponse.ok) {
    throw new Error(`Drive resumable init failed: ${initResponse.status}`);
  }

  const uploadUrl = initResponse.headers.get('Location');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': content.byteLength || content.length,
    },
    body: content,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Drive resumable upload failed: ${uploadResponse.status}`);
  }

  return uploadResponse.json();
}

const SIZE_5MB = 5 * 1024 * 1024;

export async function smartUpload(name, mimeType, content, parentId, token) {
  const size = content.byteLength || content.length || 0;
  if (size > SIZE_5MB) {
    return uploadFileResumable(name, mimeType, content, parentId, token);
  }
  return uploadFile(name, mimeType, content, parentId, token);
}

export async function listSharedDrives(token) {
  const data = await apiRequest(
    `${DRIVE_API}/drives?pageSize=100&fields=drives(id,name)`,
    token
  );
  return data.drives || [];
}

export async function listFolders(parentId, token, driveId = null) {
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  let url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=name&pageSize=100`;

  if (driveId) {
    url += `&corpora=drive&driveId=${driveId}&includeItemsFromAllDrives=true&supportsAllDrives=true`;
  }

  const data = await apiRequest(url, token);
  return data.files || [];
}

export async function getFolderInfo(folderId, token) {
  const data = await apiRequest(
    `${DRIVE_API}/files/${folderId}?fields=id,name,parents&supportsAllDrives=true`,
    token
  );
  return data;
}

export async function findFolderInParent(name, parentId, token, supportsShared = false) {
  const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  let url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;

  if (supportsShared) {
    url += '&includeItemsFromAllDrives=true&supportsAllDrives=true';
  }

  const data = await apiRequest(url, token);
  return data.files?.[0] || null;
}

export async function createFolderInDrive(name, parentId, token, supportsShared = false) {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId],
  };

  let url = `${DRIVE_API}/files`;
  if (supportsShared) {
    url += '?supportsAllDrives=true';
  }

  return apiRequest(url, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
}

export async function findOrCreateInParent(name, parentId, token, supportsShared = false) {
  const existing = await findFolderInParent(name, parentId, token, supportsShared);
  if (existing) return existing;
  return createFolderInDrive(name, parentId, token, supportsShared);
}

export async function ensureSavePath(destinationId, datePath, emailName, token, supportsShared = false) {
  let parentId = destinationId;

  if (datePath) {
    const dateFolder = await findOrCreateInParent(datePath, parentId, token, supportsShared);
    parentId = dateFolder.id;
  }

  const emailFolder = await findOrCreateInParent(emailName, parentId, token, supportsShared);
  return emailFolder;
}

export async function uploadToSharedDrive(name, mimeType, content, parentId, token) {
  const metadata = {
    name,
    parents: [parentId],
  };

  const MULTIPART_BOUNDARY = 'gmail_to_drive_boundary';

  let contentBase64;
  if (content instanceof Uint8Array || content instanceof ArrayBuffer) {
    const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : content;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    contentBase64 = btoa(binary);
  } else if (typeof content === 'string') {
    contentBase64 = btoa(unescape(encodeURIComponent(content)));
  } else {
    throw new Error('Unsupported content type for upload');
  }

  const body = [
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${MULTIPART_BOUNDARY}`,
    `Content-Type: ${mimeType}`,
    'Content-Transfer-Encoding: base64',
    '',
    contentBase64,
    `--${MULTIPART_BOUNDARY}--`,
  ].join('\r\n');

  return apiRequest(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`,
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
      },
      body,
    }
  );
}

export async function smartUploadAnywhere(name, mimeType, content, parentId, token, supportsShared = false) {
  if (supportsShared) {
    return uploadToSharedDrive(name, mimeType, content, parentId, token);
  }
  return smartUpload(name, mimeType, content, parentId, token);
}
