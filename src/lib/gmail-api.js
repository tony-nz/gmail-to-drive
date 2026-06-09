import { base64UrlDecode, extractHeader, extractEmailAddress } from './utils.js';

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';

async function apiGet(endpoint, token) {
  const response = await fetch(`${GMAIL_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Gmail API error ${response.status}: ${error.error?.message || response.statusText}`);
  }

  return response.json();
}

export async function getThread(threadId, token) {
  return apiGet(`/threads/${threadId}?format=full`, token);
}

export async function getMessage(messageId, token) {
  return apiGet(`/messages/${messageId}?format=full`, token);
}

export async function listRecentThreads(token, maxResults = 50) {
  return apiGet(`/threads?maxResults=${maxResults}&fields=threads(id,snippet)`, token);
}

export async function searchMessages(query, token, maxResults = 10) {
  return apiGet(`/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`, token);
}

export async function getAttachment(messageId, attachmentId, token) {
  const data = await apiGet(`/messages/${messageId}/attachments/${attachmentId}`, token);
  return base64UrlDecode(data.data);
}

export function extractHtmlBody(payload) {
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    const bytes = base64UrlDecode(payload.body.data);
    return new TextDecoder().decode(bytes);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'multipart/alternative' || part.mimeType === 'multipart/related') {
        const nested = extractHtmlBody(part);
        if (nested) return nested;
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        const bytes = base64UrlDecode(part.body.data);
        return new TextDecoder().decode(bytes);
      }
    }

    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        const bytes = base64UrlDecode(part.body.data);
        const text = new TextDecoder().decode(bytes);
        return `<pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${escapeHtml(text)}</pre>`;
      }
    }
  }

  if (payload.body?.data) {
    const bytes = base64UrlDecode(payload.body.data);
    const text = new TextDecoder().decode(bytes);
    return `<pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${escapeHtml(text)}</pre>`;
  }

  return null;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function extractAttachments(payload) {
  const attachments = [];

  function walk(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0,
        });
      }
      if (part.parts) {
        walk(part.parts);
      }
    }
  }

  if (payload.parts) {
    walk(payload.parts);
  }

  return attachments;
}

export function getMessageMeta(message) {
  const headers = message.payload?.headers || [];
  return {
    id: message.id,
    threadId: message.threadId,
    subject: extractHeader(headers, 'Subject') || '(no subject)',
    from: extractEmailAddress(headers),
    date: extractHeader(headers, 'Date'),
    to: extractHeader(headers, 'To'),
  };
}
