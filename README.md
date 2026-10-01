# locally

locally is a Chrome extension that collects local businesses from Google Maps while you scroll, then looks up emails on their websites when you ask it to.

Leads stay in your browser. The extension does not send them to a server.

## What it collects

From the Maps results list: name, category, rating, review count, address, and the Maps link. If you open a listing, it also saves the phone, website, and any email Maps already shows.

After you click **Find emails**, it adds the website email and where it was found: Google Maps, the homepage, or a contact page.

## Install

### Chrome Web Store

Install **locally** from the Chrome Web Store, then pin it from the extensions menu.

### From source

1. Clone this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose this folder.
5. Pin **locally** and click the icon.

Chrome will ask for permission to read websites. That permission is only used when you run **Find emails**.

## How to use it

1. Click the extension icon. A side panel opens and Google Maps comes to the front.
2. Search as usual, for example “dentists in Dubai”.
3. Scroll the **results list on the left**. Each new business is saved. Scrolling the map itself does not add listings.
4. When the list looks right, click **Find emails**. locally opens each saved place that does not already have an email, reads the website, then checks the homepage and a contact or about page.
5. Use **Pause** or **Stop** during that step. Already found emails stay saved.
6. Filter the list, copy an email from a card, or click a card to reopen that place on Maps.
7. Click **Export CSV** when you want the spreadsheet. The file is named `locally-YYYY-MM-DD.csv`.

**Clear** deletes the saved list from this browser.

## Permissions

| Permission | Why |
| --- | --- |
| Side panel | Keeps the lead list open while you use Maps. |
| Storage | Saves leads on this computer. |
| Tabs | Finds or opens your Google Maps tab. |
| Scripting | Reads the Maps results list from the page you are viewing. |
| Site access (`http` and `https`) | Opens a business website only after you click **Find emails**. |

## Privacy

locally is a local tool.

- Leads are stored with `chrome.storage.local` on your device.
- Website pages are fetched in your browser only after you click **Find emails**.
- There is no account, no analytics, and no remote server.
- Clearing the list, or removing the extension, deletes the saved leads.

If you publish this on the Chrome Web Store, use this section as the privacy policy, or host it at a public URL and paste that URL into the store listing.

## Limits

- Google changes Maps often. If a search adds nothing, scroll the left-hand results list, not the map.
- List cards rarely include a website. The email step opens each place to read it.
- Some sites hide the address in an image or a form. Those rows stay marked as having no email.
- A Facebook or Instagram link is not treated as a website.
- You are responsible for how you contact the businesses you save, including anti-spam and privacy rules where you operate.

## Project layout

```
manifest.json          Extension config
background.js          Opens Maps and runs the email queue
content/maps.js        Reads the Maps results list
lib/parse-lead.js      Turns a Maps card into lead fields
lib/extract-email.js   Finds emails in a page
sidepanel.html         Side panel
icons/                 Toolbar icons
fonts/                 Fira Sans and Fira Code
```

Parser checks:

```bash
node test/run-tests.mjs
```

## Store listing

Suggested Chrome Web Store copy:

**Summary:** Collect local businesses from Google Maps, then find emails on their websites.

**Description:** locally saves businesses as you scroll a Google Maps search. When you are ready, it reads each business website and looks for an email on the homepage or contact page. Results stay on your computer and export to CSV.
