# Gmail2Drive — Privacy Policy

_Last updated: 2 July 2026_

Gmail2Drive is a Chrome extension that saves Gmail emails you select as PDFs,
along with their attachments, into your own Google Drive.

## What the extension accesses

To do its job, Gmail2Drive uses Google authorization (OAuth) to request the
following access **on your behalf, within your own Google account**:

- **Read your Gmail messages (`gmail.readonly`)** — only the emails you
  explicitly select are read, in order to render them to PDF and to download
  their attachments. Emails are never modified, deleted, or sent.
- **Google Drive (`drive`)** — used to create folders and upload the generated
  PDFs and attachments, and to let you browse and choose a destination folder.

## What data is collected

**None.** Gmail2Drive does not collect, store, transmit, sell, or share any of
your data with the developer or any third party. There are no analytics, no
tracking, and no external servers.

## Where your data goes

All processing happens locally in your browser/extension. Your email content
and attachments travel only between your browser and **Google's own APIs**
(Gmail and Drive) using your authorization. PDFs and attachments are written
solely to **your** Google Drive, to the folder you choose.

The only data the extension stores is your **preferences** (such as your chosen
destination folder), kept in Chrome's `storage.sync` so your settings follow
your Chrome profile. This never leaves Google's infrastructure.

## Permissions

- `identity` — to obtain a Google OAuth token for the Gmail and Drive APIs.
- `storage` — to remember your settings.
- `offscreen` — to render selected emails to PDF in the background.
- `scripting` — to inject the "Save to Drive" button into Gmail and keep it
  working across extension updates.
- `notifications` — to show progress and completion notices while emails are
  being saved.
- `activeTab` / host access to `mail.google.com` — to add the "Save to Drive"
  button to Gmail.
- host access to `www.googleapis.com` — to call the Gmail and Drive APIs.

## Data retention and deletion

The extension retains no data of its own beyond your local settings, which you
can clear at any time by removing the extension. Files saved to your Google
Drive are owned and controlled entirely by you.

## Revoking access

You can revoke Gmail2Drive's access to your Google account at any time at
<https://myaccount.google.com/permissions>.

## Contact

Questions about this policy: **tony@myers.co.nz**
