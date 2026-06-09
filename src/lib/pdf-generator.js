let offscreenReady = false;
const pendingRequests = new Map();
let requestId = 0;

async function ensureOffscreenDocument() {
  if (offscreenReady) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length > 0) {
    offscreenReady = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Convert email HTML to PDF using html2pdf.js',
  });

  offscreenReady = true;
}

export async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // already closed
  }
  offscreenReady = false;
}

export async function generatePdf(html, subject, from, date) {
  await ensureOffscreenDocument();

  const id = ++requestId;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('PDF generation timed out'));
    }, 30000);

    pendingRequests.set(id, { resolve, reject, timeout });

    chrome.runtime.sendMessage({
      action: 'GENERATE_PDF',
      id,
      html,
      subject,
      from,
      date,
    });
  });
}

export function handlePdfResponse(message) {
  if (message.action !== 'PDF_GENERATED') return false;

  const pending = pendingRequests.get(message.id);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingRequests.delete(message.id);

  if (message.error) {
    pending.reject(new Error(message.error));
  } else {
    pending.resolve(message.pdfData);
  }

  return true;
}
