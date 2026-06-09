export function base64UrlDecode(data) {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64UrlToBase64(data) {
  return data.replace(/-/g, '+').replace(/_/g, '/');
}

export function sanitizeFilename(name, maxLength = 100) {
  if (!name) return 'untitled';
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength) || 'untitled';
}

export function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function extractEmailAddress(headers) {
  const from = headers.find((h) => h.name.toLowerCase() === 'from');
  if (!from) return 'unknown';
  const match = from.value.match(/<([^>]+)>/);
  return match ? match[1] : from.value;
}

export function extractHeader(headers, name) {
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function concurrencyLimit(tasks, limit) {
  const results = [];
  let running = 0;
  let index = 0;

  return new Promise((resolve, reject) => {
    function runNext() {
      if (index >= tasks.length && running === 0) {
        resolve(results);
        return;
      }

      while (running < limit && index < tasks.length) {
        const currentIndex = index++;
        running++;
        tasks[currentIndex]()
          .then((result) => {
            results[currentIndex] = { status: 'fulfilled', value: result };
          })
          .catch((error) => {
            results[currentIndex] = { status: 'rejected', reason: error };
          })
          .finally(() => {
            running--;
            runNext();
          });
      }
    }

    runNext();
  });
}

export async function retryWithBackoff(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
