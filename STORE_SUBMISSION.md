# Chrome Web Store submission (Unlisted)

This is the step-by-step for publishing Gmail2Drive as an **Unlisted** item and
wiring OAuth to the Store-assigned extension ID.

## 0. Before you start
- You have a Chrome Web Store developer account (the one-time $5 fee paid).
- Privacy policy (`PRIVACY.md`) is hosted at a public URL. Easiest: enable
  GitHub Pages on this repo, or paste the policy into a public Gist / page.

## 1. Build the upload package
```sh
npm run build
cd dist && zip -r ../gmail2drive.zip . && cd ..
```
Upload `gmail2drive.zip`.

> Note: the manifest's `key` field is only for keeping a stable ID during local
> (unpacked) development. The Store assigns its **own** ID and ignores it — you
> can leave it in; it does not affect the Store build.

## 2. Create the Store item
1. Go to the **Chrome Web Store Developer Dashboard**:
   <https://chrome.google.com/webstore/devconsole>
2. **Add new item** → upload `gmail2drive.zip`.
3. Fill in the listing (copy below). For **Visibility**, choose **Unlisted**.
4. Add the **Privacy policy URL** and complete the **Permissions justifications**
   (copy below) and the **data usage** disclosures (we collect nothing).
5. Save the draft — **do not submit yet.** First grab the new ID (step 3).

## 3. Get the Store-assigned extension ID
On the item's page in the dashboard, copy the **Item ID** (a 32-char id, e.g.
`abcd...`). This is **different** from the dev ID `bgcambaffhallmkgfkffmlnbmmpifhak`.

## 4. Re-register OAuth for the new ID
Because OAuth Chrome-Extension clients are bound to one extension ID:
1. Google Cloud → **Google Auth Platform → Clients** →
   <https://console.cloud.google.com/auth/clients?project=gmail2drive-nz>
2. **Create client** → type **Chrome Extension** → **Item ID** = the Store ID
   from step 3 → Create. Copy the new **Client ID**.
3. Update `manifest.json` → `oauth2.client_id` to the new Client ID.
4. `npm run build`, re-zip (step 1), and upload the new version to the item.

> Optional: to make your local unpacked dev build share the Store ID, copy the
> item's public key from the dashboard ("Package" → public key) into the
> manifest `key` field. Not required.

## 5. Submit & share
1. Submit the item for review (Unlisted items still get a basic review; usually
   quick for a small extension).
2. Once approved, share the **Unlisted install link** with your users.
3. **Add each user as a Test user** in Google Auth Platform → Audience
   (<https://console.cloud.google.com/auth/audience?project=gmail2drive-nz>),
   up to 100. They must be test users to authorize while the OAuth app is in
   Testing mode.

---

## Listing copy

**Name:** Gmail2Drive

**Summary (≤132 chars):**
Save selected Gmail emails as PDFs — with their attachments — straight to your
Google Drive, organised into folders.

**Description:**
Gmail2Drive adds a "Save to Drive" button to Gmail. Select one or more
conversations and it saves each conversation as a single combined PDF, with all
of its attachments, into its own subject-named folder in your Google Drive.

- One folder per conversation, named after the subject
- All messages in a conversation combined into one PDF
- Attachments saved alongside the PDF (duplicates removed)
- Inline images (logos, signatures) embedded in the PDF
- Choose any destination folder, including Shared Drives

Your data stays yours: everything runs in your browser and talks only to
Google's Gmail and Drive APIs. No external servers, no tracking, nothing
collected.

**Category:** Productivity / Workflow & Planning

**Single purpose:** Save selected Gmail emails (and their attachments) as PDFs
to the user's Google Drive.

---

## Permission justifications (for the review form)

- **gmail.readonly** — Read the content and attachments of the emails the user
  selects, in order to render them to PDF and save the attachments. No emails
  are modified, deleted, or sent.
- **drive** — Create folders and upload the generated PDFs and attachments, and
  let the user browse/select a destination folder (including Shared Drives).
- **identity** — Obtain the Google OAuth token needed to call the Gmail and
  Drive APIs.
- **storage** — Remember the user's chosen destination folder and settings.
- **offscreen** — Render selected emails to PDF in a background document.
- **notifications** — Inform the user when a save completes or fails.
- **host: mail.google.com** — Inject the "Save to Drive" button into Gmail.
- **host: www.googleapis.com** — Call the Gmail and Drive REST APIs.

**Remote code:** None. All code is bundled in the package.
**Data collection:** None.
