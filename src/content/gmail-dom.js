const BUTTON_ID = 'gmail-to-drive-btn';

export function waitForGmailReady() {
  return new Promise((resolve) => {
    const check = () => {
      const toolbar = getActionBar();
      if (toolbar) {
        resolve(toolbar);
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

function getActionBar() {
  const mtb = document.querySelector('[gh="mtb"]');
  if (mtb) return mtb;
  return document.querySelector('.G-atb');
}

// Find the action icon (Archive/Delete) we want to sit next to.
function getAnchorButton() {
  const bar = getActionBar();
  if (!bar) return null;

  return bar.querySelector('[aria-label="Delete"]') ||
         bar.querySelector('[aria-label="Archive"]') ||
         bar.querySelector('[act="10"]') ||
         bar.querySelector('[act="7"]') ||
         null;
}

export function injectButton() {
  if (document.getElementById(BUTTON_ID)) return;

  const bar = getActionBar();
  if (!bar) return;

  const button = document.createElement('div');
  button.id = BUTTON_ID;
  button.className = 'gmail-to-drive-button';
  button.setAttribute('role', 'button');
  button.setAttribute('tabindex', '0');
  button.setAttribute('aria-label', 'Save to Drive');
  button.setAttribute('data-tooltip', 'Save to Drive');

  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15.5 2H8.6c-.4 0-.8.2-1.1.5-.3.3-.5.7-.5 1.1v12.8c0 .4.2.8.5 1.1.3.3.7.5 1.1.5h9.8c.4 0 .8-.2 1.1-.5.3-.3.5-.7.5-1.1V6.5L15.5 2z"/>
      <polyline points="14,2 14,8 20,8"/>
      <line x1="12" y1="18" x2="12" y2="12"/>
      <polyline points="9,15 12,12 15,15"/>
    </svg>
    <span class="gmail-to-drive-label">Save to Drive</span>
  `;

  // Place it immediately after the Delete/Archive icon so it stays in the
  // action cluster regardless of which Gmail view is showing.
  const anchor = getAnchorButton();
  if (anchor && anchor.parentElement) {
    anchor.parentElement.insertBefore(button, anchor.nextSibling);
  } else {
    bar.appendChild(button);
  }

  return button;
}

export function getSelectedThreadIds() {
  const threadIds = [];

  const allRows = document.querySelectorAll('tr');

  for (const row of allRows) {
    if (!isRowSelected(row)) continue;

    const threadId = extractThreadIdFromRow(row);
    if (threadId) {
      threadIds.push(threadId);
    }
  }

  return [...new Set(threadIds)];
}

function isRowSelected(row) {
  const ariaCheckbox = row.querySelector('[role="checkbox"][aria-checked="true"]');
  if (ariaCheckbox) return true;

  const nativeCheckbox = row.querySelector('input[type="checkbox"]:checked');
  if (nativeCheckbox) return true;

  if (row.classList.contains('x7')) return true;

  if (row.getAttribute('aria-selected') === 'true') return true;

  return false;
}

function extractThreadIdFromRow(row) {
  // 1. Look for data-legacy-thread-id first (hex format the API understands)
  const legacyId = row.getAttribute('data-legacy-thread-id');
  if (legacyId) return cleanThreadId(legacyId);

  const legacyEl = row.querySelector('[data-legacy-thread-id]');
  if (legacyEl) return cleanThreadId(legacyEl.getAttribute('data-legacy-thread-id'));

  // 2. data-thread-id (may be in various formats)
  const dataThreadId = row.getAttribute('data-thread-id');
  if (dataThreadId) return cleanThreadId(dataThreadId);

  const threadEl = row.querySelector('[data-thread-id]');
  if (threadEl) return cleanThreadId(threadEl.getAttribute('data-thread-id'));

  const permIdEl = row.querySelector('[data-thread-perm-id]');
  if (permIdEl) return cleanThreadId(permIdEl.getAttribute('data-thread-perm-id'));

  // 3. Extract from anchor hrefs
  const anchors = row.querySelectorAll('a[href]');
  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') || '';

    // Gmail URL pattern: #inbox/FMfcgzQXKkbc... or #inbox/18a1b2c3d4e5f6
    const hashMatch = href.match(/#(?:inbox|all|sent|starred|drafts|imp|trash|spam|label\/[^/]+)\/([a-zA-Z0-9_-]+)/);
    if (hashMatch) return cleanThreadId(hashMatch[1]);

    const fullMatch = href.match(/\/mail\/u\/\d+\/#[^/]+\/([a-zA-Z0-9_-]+)/);
    if (fullMatch) return cleanThreadId(fullMatch[1]);
  }

  // 4. data-message-id
  const msgIdEl = row.querySelector('[data-message-id]');
  const msgId = row.getAttribute('data-message-id') || (msgIdEl && msgIdEl.getAttribute('data-message-id'));
  if (msgId) return cleanThreadId(msgId);

  return null;
}

function cleanThreadId(id) {
  if (!id) return null;

  // Strip Gmail client-side prefixes like "#thread-a:", "#thread-f:", "#msg-a:", etc.
  const stripped = id.replace(/^#?(thread|msg)-[a-z]:/, '');

  // If it looks like a valid ID (alphanumeric, not empty), return it
  if (stripped && /^[a-zA-Z0-9_-]+$/.test(stripped)) {
    return stripped;
  }

  return null;
}

export function observeToolbarChanges(callback) {
  const target = document.querySelector('[role="main"]') || document.body;
  const observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) {
      const bar = getActionBar();
      if (bar) {
        callback();
      }
    }
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
  });

  return observer;
}
