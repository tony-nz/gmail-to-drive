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

async function convertToPdf({ html, subject, from, date }) {
  const container = document.getElementById('pdf-container');

  const headerHtml = `
    <div style="font-family: Arial, sans-serif; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #4285f4;">
      <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #202124;">${escapeHtml(subject)}</h2>
      <div style="font-size: 13px; color: #5f6368;">
        <div style="margin-bottom: 2px;"><strong>From:</strong> ${escapeHtml(from)}</div>
        <div><strong>Date:</strong> ${escapeHtml(date)}</div>
      </div>
    </div>
  `;

  // Clean up the email HTML
  const cleanedHtml = cleanEmailHtml(html);

  container.innerHTML = headerHtml + `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #202124; word-wrap: break-word;">${cleanedHtml}</div>`;

  // Wait for images to load
  await waitForImages(container);

  // Small delay to let the browser finish layout
  await new Promise((r) => setTimeout(r, 200));

  console.log('[GTD Offscreen] Container size:', container.offsetWidth, 'x', container.offsetHeight);
  console.log('[GTD Offscreen] Container text length:', container.innerText.length);

  const options = {
    margin: [10, 10, 10, 10],
    filename: 'email.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
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
