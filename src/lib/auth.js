// Note: chrome.identity.getAuthToken reads scopes from manifest.json's
// "oauth2" block, not from here. Kept in sync for reference.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive',
];

let cachedToken = null;

export async function getToken(interactive = true) {
  if (cachedToken) {
    return cachedToken;
  }

  return new Promise((resolve, reject) => {
    console.log('[Gmail to Drive] Requesting auth token, interactive:', interactive);
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        console.error('[Gmail to Drive] Auth error:', chrome.runtime.lastError.message);
        cachedToken = null;
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      console.log('[Gmail to Drive] Token obtained successfully');
      cachedToken = token;
      resolve(token);
    });
  });
}

export async function revokeToken() {
  const token = cachedToken;
  cachedToken = null;

  if (!token) return;

  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
        .then(() => resolve())
        .catch(() => resolve());
    });
  });
}

export async function isAuthenticated() {
  try {
    const token = await getToken(false);
    return !!token;
  } catch {
    return false;
  }
}

export function clearCachedToken() {
  cachedToken = null;
}
