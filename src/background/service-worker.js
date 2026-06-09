import { getToken, clearCachedToken } from '../lib/auth.js';
import { getThread, extractHtmlBody, extractAttachments, getAttachment, getMessageMeta, listRecentThreads } from '../lib/gmail-api.js';
import {
  ensureSavePath, smartUploadAnywhere,
  listSharedDrives, listFolders, getFolderInfo, createFolderInDrive,
} from '../lib/drive-api.js';
import { generatePdf, handlePdfResponse, closeOffscreenDocument } from '../lib/pdf-generator.js';
import { sanitizeFilename, formatDate, concurrencyLimit, retryWithBackoff } from '../lib/utils.js';

const CONCURRENCY = 3;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (handlePdfResponse(message)) return;

  switch (message.action) {
    case 'SAVE_TO_DRIVE':
      console.log('[GTD] SAVE_TO_DRIVE received, threadIds:', message.threadIds, 'dest:', message.destination);
      handleSaveToDrive(message.threadIds, sender.tab?.id, message.destination);
      return;

    case 'GET_AUTH_STATUS':
      getToken(false)
        .then(() => sendResponse({ authenticated: true }))
        .catch(() => sendResponse({ authenticated: false }));
      return true;

    case 'SIGN_IN':
      getToken(true)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SIGN_OUT':
      import('../lib/auth.js').then(({ revokeToken }) => {
        revokeToken()
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: true }));
      });
      return true;

    case 'LIST_SHARED_DRIVES':
      getToken(true)
        .then((token) => listSharedDrives(token))
        .then((drives) => sendResponse({ drives }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'LIST_FOLDERS':
      getToken(true)
        .then((token) => listFolders(message.parentId, token, message.driveId))
        .then((folders) => sendResponse({ folders }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'GET_FOLDER_INFO':
      getToken(true)
        .then((token) => getFolderInfo(message.folderId, token))
        .then((folder) => sendResponse({ folder }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'CREATE_FOLDER':
      getToken(true)
        .then((token) => createFolderInDrive(message.name, message.parentId, token, !!message.driveId))
        .then((folder) => sendResponse({ folder }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'RESOLVE_THREAD_IDS':
      getToken(true)
        .then((token) => resolveThreadIds(message.candidateIds, token))
        .then((resolvedIds) => sendResponse({ resolvedIds }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;
  }
});

async function handleSaveToDrive(threadIds, tabId, destination) {
  if (!threadIds || threadIds.length === 0) {
    notifyTab(tabId, { action: 'SAVE_ERROR', error: 'No emails selected' });
    return;
  }

  notifyTab(tabId, {
    action: 'SAVE_PROGRESS',
    current: 0,
    total: threadIds.length,
    status: 'Authenticating...',
  });

  let token;
  try {
    token = await getToken(true);
    console.log('[GTD] Auth OK');
  } catch (error) {
    console.error('[GTD] Auth FAILED:', error.message);
    notifyTab(tabId, { action: 'SAVE_ERROR', error: `Auth failed: ${error.message}` });
    return;
  }

  const settings = await getSettings();

  // Destination from folder picker overrides stored settings
  if (destination) {
    settings.destinationFolderId = destination.folderId;
    settings.driveId = destination.driveId;
    console.log('[GTD] Using picker destination:', destination.folderId, destination.path);
  }

  console.log('[GTD] Settings:', JSON.stringify(settings));

  const results = { success: 0, failed: 0, errors: [], folderLinks: [] };

  const tasks = threadIds.map((threadId, index) => {
    return () => processThread(threadId, token, settings, tabId, index, threadIds.length, results);
  });

  await concurrencyLimit(tasks, CONCURRENCY);

  await closeOffscreenDocument();

  console.log('[GTD] Done. Success:', results.success, 'Failed:', results.failed);
  if (results.errors.length > 0) {
    console.error('[GTD] Errors:', JSON.stringify(results.errors));
  }

  notifyTab(tabId, {
    action: 'SAVE_COMPLETE',
    results,
  });
}

async function processThread(threadId, token, settings, tabId, index, total, results) {
  try {
    await retryWithBackoff(async () => {
      console.log(`[GTD] Processing thread ${index + 1}/${total}: ${threadId}`);

      notifyTab(tabId, {
        action: 'SAVE_PROGRESS',
        current: index + 1,
        total,
        status: `Fetching email ${index + 1} of ${total}...`,
      });

      let thread;
      try {
        thread = await getThread(threadId, token);
        console.log(`[GTD] Thread fetched, ${thread.messages?.length || 0} messages`);
      } catch (err) {
        console.warn(`[GTD] Thread fetch failed for "${threadId}": ${err.message}`);
        console.log('[GTD] Thread ID from DOM may be invalid. The Gmail UI uses client-side IDs that differ from API IDs.');
        throw new Error(`Could not fetch thread "${threadId}". Gmail DOM returned a client-side ID that the API doesn't recognize. Try using the Gmail search approach instead.`);
      }

      const messages = thread.messages || [];

      if (messages.length === 0) {
        console.warn(`[GTD] Thread "${threadId}" returned 0 messages - likely an invalid/client-side thread ID`);
        throw new Error(`Thread "${threadId}" returned no messages. The ID may be a Gmail client-side reference.`);
      }

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const meta = getMessageMeta(message);
        console.log(`[GTD] Message ${i + 1}: "${meta.subject}" from ${meta.from}`);

        const folderName = sanitizeFilename(`${meta.subject} - ${meta.from}`);
        const dateStr = settings.createDateFolders ? formatDate(new Date(meta.date)) : null;
        const supportsShared = !!settings.driveId;
        const destinationId = settings.destinationFolderId || 'root';

        console.log(`[GTD] Creating folder path: dest=${destinationId}, date=${dateStr}, name=${folderName}`);

        notifyTab(tabId, {
          action: 'SAVE_PROGRESS',
          current: index + 1,
          total,
          status: `Creating folders for "${meta.subject}"...`,
        });

        const folder = await ensureSavePath(
          destinationId, dateStr, folderName, token, supportsShared
        );
        console.log(`[GTD] Folder created/found: ${folder.id} (${folder.name})`);

        const htmlBody = extractHtmlBody(message.payload);
        if (htmlBody) {
          console.log(`[GTD] Generating PDF (${htmlBody.length} chars of HTML)`);
          notifyTab(tabId, {
            action: 'SAVE_PROGRESS',
            current: index + 1,
            total,
            status: `Generating PDF for "${meta.subject}"...`,
          });

          const pdfData = await generatePdf(htmlBody, meta.subject, meta.from, meta.date);
          console.log(`[GTD] PDF generated (${pdfData.length} base64 chars)`);

          const pdfBytes = base64ToUint8Array(pdfData);
          const pdfName = messages.length > 1 ? `email-${i + 1}.pdf` : 'email.pdf';

          notifyTab(tabId, {
            action: 'SAVE_PROGRESS',
            current: index + 1,
            total,
            status: `Uploading ${pdfName}...`,
          });

          const uploaded = await smartUploadAnywhere(pdfName, 'application/pdf', pdfBytes, folder.id, token, supportsShared);
          console.log(`[GTD] PDF uploaded: ${uploaded.id}, link: ${uploaded.webViewLink}`);
          results.folderLinks.push(uploaded.webViewLink);
        } else {
          console.warn('[GTD] No HTML body found for message');
        }

        const attachments = extractAttachments(message.payload);
        console.log(`[GTD] ${attachments.length} attachments found`);

        for (const att of attachments) {
          console.log(`[GTD] Downloading attachment: ${att.filename} (${att.size} bytes)`);
          notifyTab(tabId, {
            action: 'SAVE_PROGRESS',
            current: index + 1,
            total,
            status: `Uploading ${att.filename}...`,
          });

          const data = await getAttachment(message.id, att.attachmentId, token);
          const uploaded = await smartUploadAnywhere(att.filename, att.mimeType, data, folder.id, token, supportsShared);
          console.log(`[GTD] Attachment uploaded: ${uploaded.id}`);
        }
      }

      results.success++;
      console.log(`[GTD] Thread ${threadId} done`);
    }, 2);
  } catch (error) {
    console.error(`[GTD] Thread ${threadId} FAILED:`, error.message, error.stack);
    results.failed++;
    results.errors.push({ threadId, error: error.message });
  }
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function notifyTab(tabId, message) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

async function resolveThreadIds(candidateIds, token) {
  const validIds = [];

  // First try each candidate ID directly against the API
  for (const id of candidateIds) {
    try {
      const thread = await getThread(id, token);
      if (thread.messages && thread.messages.length > 0) {
        console.log(`[GTD] ID "${id}" is valid, ${thread.messages.length} messages`);
        validIds.push(id);
        continue;
      }
    } catch {
      // Not a valid API ID
    }
  }

  if (validIds.length > 0) return validIds;

  // Fallback: list recent threads and return the count the user selected
  console.log(`[GTD] None of the ${candidateIds.length} DOM IDs were valid API IDs. Falling back to recent threads.`);
  const response = await listRecentThreads(token, candidateIds.length);
  const threads = response.threads || [];
  console.log(`[GTD] Got ${threads.length} recent threads as fallback`);
  return threads.map((t) => t.id);
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        destinationFolderId: null,
        destinationFolderName: null,
        destinationPath: 'My Drive',
        driveId: null,
        driveName: null,
        createDateFolders: true,
        exportAllMessages: true,
      },
      resolve
    );
  });
}
