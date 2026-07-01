import { getToken } from '../lib/auth.js';
import { getThread, extractHtmlBody, extractAttachments, extractInlineImages, getAttachment, getMessageMeta, listRecentThreads, getThreadMeta } from '../lib/gmail-api.js';
import {
  ensureSavePath, smartUploadAnywhere,
  listSharedDrives, listFolders, getFolderInfo, createFolderInDrive,
} from '../lib/drive-api.js';
import { generatePdf, handlePdfResponse, closeOffscreenDocument } from '../lib/pdf-generator.js';
import { sanitizeFilename, arrayBufferToBase64, concurrencyLimit, retryWithBackoff } from '../lib/utils.js';

const CONCURRENCY = 3;
// Uploads are network-bound (not CPU), so a higher fan-out than the thread-fetch
// concurrency shortens the upload-dominated tail of a save.
const UPLOAD_CONCURRENCY = 6;

// When the extension is installed or updated, Chrome orphans any content
// script already running in open Gmail tabs — its context is invalidated and
// the "Save to Drive" button silently stops working until the page reloads.
// Gmail is a long-lived SPA that users leave open for days, so we can't rely on
// a reload. Instead, re-inject a fresh content script into every open Gmail tab
// so the button keeps working seamlessly, no reload required.
chrome.runtime.onInstalled.addListener((details) => {
  if (['install', 'update', 'chrome_update'].includes(details.reason)) {
    reinjectIntoOpenTabs();
  }
});

async function reinjectIntoOpenTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  } catch (err) {
    console.warn('[GTD] Could not query Gmail tabs for re-injection:', err.message);
    return;
  }

  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['gmail-inject.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] });
      console.log('[GTD] Re-injected content script into tab', tab.id);
    } catch (err) {
      // Tab may be discarded, still loading, or otherwise not injectable — skip it.
      console.warn('[GTD] Re-inject failed for tab', tab.id, err.message);
    }
  }
}

// The extension has no popup — clicking the toolbar icon focuses an open Gmail
// tab (or opens one), since the real action lives on the in-Gmail button.
chrome.action.onClicked.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId != null) {
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    } else {
      await chrome.tabs.create({ url: 'https://mail.google.com/mail/u/0/' });
    }
  } catch (err) {
    console.warn('[GTD] Could not open Gmail from toolbar click:', err.message);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (handlePdfResponse(message)) return;

  switch (message.action) {
    case 'SAVE_TO_DRIVE':
      console.log('[GTD] SAVE_TO_DRIVE received, threadIds:', message.threadIds, 'dest:', message.destination);
      handleSaveToDrive(message.threadIds, sender.tab?.id, message.destination);
      return;

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
        .then((result) => sendResponse(result))
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

  // The folder picker always supplies the destination; remember it so the next
  // save opens there instead of at the root.
  if (destination) {
    console.log('[GTD] Using picker destination:', destination.folderId, destination.path);
    saveLastLocation(destination);
  }

  const supportsShared = !!destination?.driveId;
  const destinationId = destination?.folderId || 'root';
  const results = { success: 0, failed: 0, errors: [], folderLinks: [] };

  try {
    // 1. Fetch every selected thread (concurrently), preserving selection order.
    notifyTab(tabId, {
      action: 'SAVE_PROGRESS', current: 0, total: threadIds.length,
      status: `Fetching ${threadIds.length} conversation${threadIds.length > 1 ? 's' : ''}...`,
    });

    // Per-thread folder names from the picker (each prefilled with the email's
    // subject, individually editable), aligned with threadIds order.
    const folderNames = destination?.folderNames || [];

    const fetchTasks = threadIds.map((id) => () => retryWithBackoff(() => getThread(id, token), 2));
    const settled = await concurrencyLimit(fetchTasks, CONCURRENCY);

    const threads = [];
    settled.forEach((r, i) => {
      const thread = r.status === 'fulfilled' ? r.value : null;
      if (thread?.messages?.length > 0) {
        // Keep each thread paired with its chosen folder name (order preserved).
        threads.push({ thread, folderName: folderNames[i] });
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
    //    subject, or the user's edit), with one combined PDF and its attachments.
    for (let t = 0; t < threads.length; t++) {
      try {
        await saveConversation(
          threads[t].thread, destinationId, supportsShared, token, tabId, results, t + 1, threads.length, threads[t].folderName
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
async function saveConversation(thread, destinationId, supportsShared, token, tabId, results, index, total, folderNameOverride) {
  const messages = thread.messages;
  const rawName = folderNameOverride?.trim() || getMessageMeta(messages[0]).subject;
  const folderName = sanitizeFilename(rawName);
  const label = total > 1 ? ` (${index}/${total})` : '';
  const started = Date.now();
  console.log(`[GTD] Conversation "${folderName}": ${messages.length} message(s)`);

  notifyTab(tabId, {
    action: 'SAVE_PROGRESS', current: index - 1, total,
    status: `Preparing "${folderName}"${label}...`,
  });

  // Kick off folder creation immediately so it overlaps with PDF preparation
  // below — the two are independent and each takes ~1-3s.
  const folderPromise = ensureSavePath(destinationId, null, folderName, token, supportsShared);

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

  // Start rendering the PDF now; it runs concurrently with attachment uploads.
  const pdfPromise = pdfMessages.length > 0
    ? generatePdf(folderName, pdfMessages)
    : Promise.resolve(null);

  // Every upload needs the destination folder (creation was started above).
  const folder = await folderPromise;

  // Dedupe attachments across the thread — quoted replies repeat the same files.
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

  // Attachments go into an "Attachments" subfolder so the PDF stays uncluttered
  // at the top of the conversation folder. Create it concurrently (only when
  // there are attachments) so it overlaps with PDF rendering.
  const attachmentsFolderPromise = attachments.length > 0
    ? ensureSavePath(folder.id, null, 'Attachments', token, supportsShared)
    : Promise.resolve(null);

  // Upload the PDF and every attachment concurrently. Uploads are network-bound
  // and dominate save time, so running them in parallel is the biggest win. The
  // PDF task simply awaits the render that's already in flight.
  const uploadTasks = [];

  uploadTasks.push(async () => {
    const pdfData = await pdfPromise;
    if (!pdfData) {
      console.warn(`[GTD] No HTML bodies found in "${folderName}"`);
      return;
    }
    const pdfBytes = base64ToUint8Array(pdfData);
    const uploaded = await smartUploadAnywhere(
      `${folderName}.pdf`, 'application/pdf', pdfBytes, folder.id, token, supportsShared
    );
    console.log(`[GTD] PDF uploaded: ${uploaded.id}`);
    results.folderLinks.push(uploaded.webViewLink);
  });

  for (const { messageId, att } of attachments) {
    uploadTasks.push(async () => {
      const attFolder = await attachmentsFolderPromise;
      await uploadAttachment(messageId, att, attFolder.id, token, supportsShared);
    });
  }

  const totalTasks = uploadTasks.length;
  let doneTasks = 0;
  const tracked = uploadTasks.map((task, i) => async () => {
    try {
      await task();
    } catch (err) {
      const what = i === 0 ? 'PDF' : attachments[i - 1].att.filename;
      console.error(`[GTD] Upload "${what}" failed:`, err.message);
      results.errors.push({ item: what, error: err.message });
    } finally {
      doneTasks++;
      notifyTab(tabId, {
        action: 'SAVE_PROGRESS', current: index - 1, total,
        status: `Saving "${folderName}" (${doneTasks}/${totalTasks})${label}...`,
      });
    }
  });

  await concurrencyLimit(tracked, UPLOAD_CONCURRENCY);
  console.log(`[GTD] Saved "${folderName}" in ${Date.now() - started}ms`);
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
  // Validate all candidate IDs in parallel. getThreadMeta both validates (throws
  // for bad ids) and returns the subject we use to prefill folder-name fields,
  // so one metadata call per candidate covers both needs.
  const metas = await Promise.all(
    candidateIds.map((id) => getThreadMeta(id, token).catch(() => null))
  );
  let resolved = metas.filter(Boolean);

  if (resolved.length > 0) {
    console.log(`[GTD] ${resolved.length}/${candidateIds.length} candidate IDs are valid`);
  } else {
    // Fallback: list recent threads and fetch their subjects.
    console.log(`[GTD] None of the ${candidateIds.length} DOM IDs were valid API IDs. Falling back to recent threads.`);
    const response = await listRecentThreads(token, candidateIds.length);
    const threads = response.threads || [];
    console.log(`[GTD] Got ${threads.length} recent threads as fallback`);
    resolved = await Promise.all(
      threads.map((t) => getThreadMeta(t.id, token).catch(() => ({ id: t.id, subject: '(no subject)' })))
    );
  }

  // Per-thread subjects, aligned with resolvedIds, so the picker can offer one
  // editable folder name per selected email.
  return {
    resolvedIds: resolved.map((r) => r.id),
    subjects: resolved.map((r) => r.subject),
  };
}

// Remember where the user last saved so the picker can reopen there. Only the
// fields the picker needs to restore the location — not the per-save name.
function saveLastLocation(destination) {
  chrome.storage.sync.set({
    lastLocation: {
      folderId: destination.folderId,
      folderName: destination.folderName,
      driveId: destination.driveId || null,
      path: destination.path,
    },
  });
}
