import { getToken, clearCachedToken } from '../lib/auth.js';
import { getThread, threadExists, extractHtmlBody, extractAttachments, extractInlineImages, getAttachment, getMessageMeta, listRecentThreads } from '../lib/gmail-api.js';
import {
  ensureSavePath, smartUploadAnywhere,
  listSharedDrives, listFolders, getFolderInfo, createFolderInDrive,
} from '../lib/drive-api.js';
import { generatePdf, handlePdfResponse, closeOffscreenDocument } from '../lib/pdf-generator.js';
import { sanitizeFilename, arrayBufferToBase64, concurrencyLimit, retryWithBackoff } from '../lib/utils.js';

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

  const supportsShared = !!settings.driveId;
  const destinationId = settings.destinationFolderId || 'root';
  const results = { success: 0, failed: 0, errors: [], folderLinks: [] };

  try {
    // 1. Fetch every selected thread (concurrently), preserving selection order.
    notifyTab(tabId, {
      action: 'SAVE_PROGRESS', current: 0, total: threadIds.length,
      status: `Fetching ${threadIds.length} conversation${threadIds.length > 1 ? 's' : ''}...`,
    });

    const fetchTasks = threadIds.map((id) => () => retryWithBackoff(() => getThread(id, token), 2));
    const settled = await concurrencyLimit(fetchTasks, CONCURRENCY);

    const threads = [];
    settled.forEach((r, i) => {
      const thread = r.status === 'fulfilled' ? r.value : null;
      if (thread?.messages?.length > 0) {
        threads.push(thread);
      } else {
        results.failed++;
        results.errors.push({
          threadId: threadIds[i],
          error: r.reason?.message || 'Thread returned no messages',
        });
      }
    });

    if (threads.length === 0) {
      throw new Error('Could not fetch any of the selected emails.');
    }

    // 2. Each conversation -> its own folder (named after that conversation's
    //    subject), with one combined PDF and that conversation's attachments.
    for (let t = 0; t < threads.length; t++) {
      try {
        await saveConversation(
          threads[t], destinationId, supportsShared, token, tabId, results, t + 1, threads.length
        );
        results.success++;
      } catch (err) {
        console.error('[GTD] Conversation FAILED:', err.message, err.stack);
        results.failed++;
        results.errors.push({ error: err.message });
      }
    }
  } catch (error) {
    console.error('[GTD] Save FAILED:', error.message, error.stack);
    if (results.failed === 0) results.failed = threadIds.length;
    results.errors.push({ error: error.message });
  }

  await closeOffscreenDocument();

  console.log('[GTD] Done. Success:', results.success, 'Failed:', results.failed);
  if (results.errors.length > 0) {
    console.error('[GTD] Errors:', JSON.stringify(results.errors));
  }

  notifyTab(tabId, { action: 'SAVE_COMPLETE', results });
}

// Save one conversation into its own subject-named folder: a single combined
// PDF of all its messages, plus all its attachments.
async function saveConversation(thread, destinationId, supportsShared, token, tabId, results, index, total) {
  const messages = thread.messages;
  const folderName = sanitizeFilename(getMessageMeta(messages[0]).subject);
  const label = total > 1 ? ` (${index}/${total})` : '';
  console.log(`[GTD] Conversation "${folderName}": ${messages.length} message(s)`);

  notifyTab(tabId, {
    action: 'SAVE_PROGRESS', current: index - 1, total,
    status: `Creating folder "${folderName}"${label}...`,
  });

  const folder = await ensureSavePath(destinationId, null, folderName, token, supportsShared);

  // One combined PDF of every message in this conversation. Inline images
  // (cid: references) are downloaded and embedded so they render in the PDF.
  const pdfMessages = [];
  for (const m of messages) {
    let html = extractHtmlBody(m.payload);
    if (!html) continue;
    html = await embedInlineImages(html, m, token);
    const meta = getMessageMeta(m);
    pdfMessages.push({ html, from: meta.from, date: meta.date, subject: meta.subject });
  }

  if (pdfMessages.length > 0) {
    notifyTab(tabId, {
      action: 'SAVE_PROGRESS', current: index - 1, total,
      status: `Generating PDF for "${folderName}"${label}...`,
    });

    const pdfData = await generatePdf(folderName, pdfMessages);
    const pdfBytes = base64ToUint8Array(pdfData);

    notifyTab(tabId, {
      action: 'SAVE_PROGRESS', current: index - 1, total,
      status: `Uploading PDF for "${folderName}"${label}...`,
    });

    const uploaded = await smartUploadAnywhere(
      `${folderName}.pdf`, 'application/pdf', pdfBytes, folder.id, token, supportsShared
    );
    console.log(`[GTD] PDF uploaded: ${uploaded.id}`);
    results.folderLinks.push(uploaded.webViewLink);
  } else {
    console.warn(`[GTD] No HTML bodies found in "${folderName}"`);
  }

  // All attachments from this conversation, into the same folder. Quoted
  // replies repeat the same files, so dedupe by name + size + type.
  const attachments = [];
  const seen = new Set();
  for (const message of messages) {
    for (const att of extractAttachments(message.payload)) {
      const key = `${att.filename}|${att.size}|${att.mimeType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attachments.push({ messageId: message.id, att });
    }
  }

  if (attachments.length > 0) {
    const totalAtt = attachments.length;
    let doneAtt = 0;
    const attachmentTasks = attachments.map(({ messageId, att }) => async () => {
      try {
        await uploadAttachment(messageId, att, folder.id, token, supportsShared);
      } catch (err) {
        console.error(`[GTD] Attachment "${att.filename}" failed:`, err.message);
        results.errors.push({ attachment: att.filename, error: err.message });
      } finally {
        doneAtt++;
        notifyTab(tabId, {
          action: 'SAVE_PROGRESS', current: index - 1, total,
          status: `Uploading attachments for "${folderName}" (${doneAtt}/${totalAtt})${label}...`,
        });
      }
    });
    await concurrencyLimit(attachmentTasks, CONCURRENCY);
  }
}

// Replace cid: image references in the HTML with embedded data URIs so they
// render in the PDF (the offscreen page can't fetch cid: URLs directly).
// Only embed small inline images (logos/signatures). Large inline photos are
// left as cid: refs (stripped by the offscreen renderer) and still saved as
// attachments — embedding them would blow past the 64MB message size limit.
const MAX_INLINE_IMAGE_BYTES = 1024 * 1024; // 1 MB

async function embedInlineImages(html, message, token) {
  const inline = extractInlineImages(message.payload)
    .filter((img) => !img.size || img.size <= MAX_INLINE_IMAGE_BYTES);
  if (inline.length === 0) return html;

  let result = html;
  await Promise.all(inline.map(async (img) => {
    try {
      const bytes = await getAttachment(message.id, img.attachmentId, token);
      const dataUri = `data:${img.mimeType};base64,${arrayBufferToBase64(bytes)}`;
      const cidEsc = img.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match src="cid:xxx" / src='cid:xxx' regardless of quoting.
      result = result.replace(new RegExp(`cid:${cidEsc}`, 'g'), dataUri);
    } catch (err) {
      console.warn(`[GTD] Could not embed inline image cid:${img.cid}: ${err.message}`);
    }
  }));

  return result;
}

async function uploadAttachment(messageId, att, folderId, token, supportsShared) {
  return retryWithBackoff(async () => {
    console.log(`[GTD] Downloading attachment: ${att.filename} (${att.size} bytes)`);
    const data = await getAttachment(messageId, att.attachmentId, token);
    const uploaded = await smartUploadAnywhere(att.filename, att.mimeType, data, folderId, token, supportsShared);
    console.log(`[GTD] Attachment uploaded: ${uploaded.id}`);
    return uploaded;
  }, 2);
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
  // Validate all candidate IDs in parallel using lightweight existence checks
  // (no message bodies). processThread re-fetches the full thread later.
  const checks = await Promise.all(
    candidateIds.map((id) => threadExists(id, token).then((ok) => (ok ? id : null)))
  );
  const validIds = checks.filter(Boolean);

  if (validIds.length > 0) {
    console.log(`[GTD] ${validIds.length}/${candidateIds.length} candidate IDs are valid`);
    return validIds;
  }

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
