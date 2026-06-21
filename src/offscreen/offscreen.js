import html2pdf from 'html2pdf.js';

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'GENERATE_PDF') return;

  convertToPdf(message)
    .then((pdfData) => {
      chrome.runtime.sendMessage({
        action: 'PDF_GENERATED',
        id: message.id,
        pdfData,
      });
    })
    .catch((error) => {
      console.error('[GTD Offscreen] PDF error:', error);
      chrome.runtime.sendMessage({
        action: 'PDF_GENERATED',
        id: message.id,
        error: error.message,
      });
    });
});

async function convertToPdf({ subject, messages }) {
  const container = document.getElementById('pdf-container');

  const titleHtml = `
    <div style="font-family: Arial, sans-serif; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #4285f4;">
      <h2 style="margin: 0; font-size: 18px; color: #202124;">${escapeHtml(subject)}</h2>
    </div>
  `;

  // Each message: a small From/Date header, then its cleaned body.
  // Messages are separated by a divider so the whole thread reads as one document.
  const bodyHtml = messages.map((m, i) => {
    const divider = i > 0
      ? '<div style="border-top: 1px solid #dadce0; margin: 28px 0 18px;"></div>'
      : '';
    const metaHtml = `
      <div style="font-family: Arial, sans-serif; font-size: 13px; color: #5f6368; margin-bottom: 12px;">
        <div style="margin-bottom: 2px;"><strong>From:</strong> ${escapeHtml(m.from)}</div>
        <div><strong>Date:</strong> ${escapeHtml(m.date)}</div>
      </div>
    `;
    const cleanedHtml = cleanEmailHtml(m.html);
    return `${divider}${metaHtml}<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #202124; word-wrap: break-word;">${cleanedHtml}</div>`;
  }).join('');

  container.innerHTML = titleHtml + bodyHtml;

  // Wait for images to load
  await waitForImages(container);

  // Brief delay to let the browser finish layout
  await new Promise((r) => setTimeout(r, 50));

  console.log('[GTD Offscreen] Container size:', container.offsetWidth, 'x', container.offsetHeight);
  console.log('[GTD Offscreen] Container text length:', container.innerText.length);

  const options = {
    margin: [10, 10, 10, 10],
    filename: 'email.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: {
      scale: 1.5,
      useCORS: true,
      allowTaint: true,
      logging: false,
      imageTimeout: 5000,
      width: 794,
      windowWidth: 794,
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
    },
  };

  const pdfBlob = await html2pdf().set(options).from(container).outputPdf('arraybuffer');

  const bytes = new Uint8Array(pdfBlob);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  console.log('[GTD Offscreen] PDF size:', bytes.length, 'bytes');

  container.innerHTML = '';

  return btoa(binary);
}

function cleanEmailHtml(html) {
  // Strip full document wrappers - email HTML often has <html>, <head>, <body> tags
  let cleaned = html
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');

  // Remove scripts
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Remove 1x1 tracking pixels
  cleaned = cleaned.replace(/<img[^>]+(?:width|height)\s*=\s*["']?1["']?[^>]*>/gi, '');

  // Remove any leftover cid: images that couldn't be embedded — they can't be
  // loaded here and would only spew CORS errors and stall rendering.
  cleaned = cleaned.replace(/<img[^>]+src=["']cid:[^"']*["'][^>]*>/gi, '');

  // Make images have max-width to fit the page
  cleaned = cleaned.replace(/<img/gi, '<img style="max-width: 100%; height: auto;" ');

  // Ensure tables don't overflow
  cleaned = cleaned.replace(/<table/gi, '<table style="max-width: 100%; table-layout: fixed;" ');

  return cleaned;
}

function waitForImages(container) {
  const images = container.querySelectorAll('img');
  if (images.length === 0) return Promise.resolve();

  const promises = Array.from(images).map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      // Timeout per image
      setTimeout(resolve, 5000);
    });
  });

  return Promise.all(promises);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
