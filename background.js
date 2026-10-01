import { extractEmails, findContactLinks, pickPrimary } from "./lib/extract-email.js";

const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "linktr.ee", "wa.me", "api.whatsapp.com"];

let writeChain = Promise.resolve();
let queuePromise = null;
let panelPromise = null;
let stopRequested = false;
let pauseRequested = false;
let activeFetch = null;

function idleEmailRun() {
  return { active: false, paused: false, current: 0, total: 0, name: "" };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMapsUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const google =
      host === "maps.google.com" ||
      host.startsWith("maps.google.") ||
      /^www\.google\./.test(host);
    return google && (parsed.pathname === "/maps" || parsed.pathname.startsWith("/maps/"));
  } catch {
    return false;
  }
}

function namesMatch(left, right) {
  const a = String(left || "").toLowerCase().replace(/\s+/g, " ").trim();
  const b = String(right || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function sendMessage(tabId, message, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out talking to Google Maps")), timeout);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    await sendMessage(tabId, { type: "PING" }, 1200);
    return;
  } catch {
    /* inject below */
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["lib/parse-lead.js", "content/maps.js"],
  });
  await sleep(200);
  await sendMessage(tabId, { type: "PING" }, 2500);
}

async function findMapsTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.id && isMapsUrl(tab.url || "")) || null;
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || tab?.status === "complete") {
        resolve();
        return;
      }
      const listener = (id, info) => {
        if (id === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);
    });
  });
}

async function ensureMapsTab(focus) {
  const existing = await findMapsTab();
  if (existing) {
    if (focus) {
      await chrome.tabs.update(existing.id, { active: true });
      try {
        await chrome.windows.update(existing.windowId, { focused: true });
      } catch {
        /* the tab is already active */
      }
    }
    return existing.id;
  }
  const created = await chrome.tabs.create({ url: "https://www.google.com/maps", active: true });
  return created.id;
}

function updateState(mutator) {
  const job = writeChain.then(async () => {
    const state = await chrome.storage.local.get({
      leads: [],
      collecting: false,
      emailRun: idleEmailRun(),
    });
    const next = await mutator(state);
    if (!next) return state;
    await chrome.storage.local.set({
      leads: next.leads,
      collecting: next.collecting,
      emailRun: next.emailRun,
    });
    return next;
  });
  writeChain = job.then(
    () => {},
    () => {}
  );
  return job;
}

function findLeadIndex(leads, incoming) {
  return leads.findIndex((existing) => {
    if (existing.id === incoming.id) return true;
    if (existing.aliases?.includes(incoming.id)) return true;
    return false;
  });
}

function sanitizeLead(raw) {
  if (!raw?.id || !raw?.name) return null;
  const text = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  return {
    id: text(raw.id, 180),
    name: text(raw.name, 160),
    category: text(raw.category, 80),
    rating: text(raw.rating, 8),
    reviewCount: text(raw.reviewCount, 16),
    address: text(raw.address, 240),
    phone: text(raw.phone, 40),
    website: text(raw.website, 300),
    email: text(raw.email, 80).toLowerCase(),
    mapsUrl: String(raw.mapsUrl || "").slice(0, 2000),
    searchQuery: text(raw.searchQuery, 160),
  };
}

function mergeLead(previous, incoming) {
  const next = { ...previous };
  for (const key of ["name", "category", "rating", "reviewCount", "address", "mapsUrl"]) {
    if (incoming[key]) next[key] = incoming[key];
  }
  if (incoming.searchQuery && !previous.searchQuery) next.searchQuery = incoming.searchQuery;
  if (incoming.phone) next.phone = incoming.phone;
  if (incoming.website) next.website = incoming.website;
  if (incoming.email && !previous.email) {
    next.email = incoming.email;
    next.emailSource = "maps";
    next.status = "found";
    next.error = "";
  }
  if (incoming.id && incoming.id !== previous.id) {
    const aliases = new Set(previous.aliases || []);
    aliases.add(incoming.id);
    next.aliases = [...aliases];
  }
  return next;
}

function upsertLeads(incoming) {
  return updateState((state) => {
    let changed = false;
    const leads = state.leads.slice();
    for (const raw of incoming) {
      const lead = sanitizeLead(raw);
      if (!lead) continue;
      const index = findLeadIndex(leads, lead);
      if (index === -1) {
        leads.push({
          ...lead,
          emailSource: lead.email ? "maps" : "",
          status: lead.email ? "found" : "saved",
          error: "",
          aliases: [],
          capturedAt: new Date().toISOString(),
        });
        changed = true;
      } else {
        const merged = mergeLead(leads[index], lead);
        if (JSON.stringify(merged) !== JSON.stringify(leads[index])) {
          leads[index] = merged;
          changed = true;
        }
      }
    }
    if (!changed) return null;
    return { ...state, leads };
  });
}

async function beginCollecting() {
  const tabId = await ensureMapsTab(true);
  await waitTabComplete(tabId);
  await chrome.storage.session.set({ suppressAutoStart: false });
  await updateState((state) => ({ ...state, collecting: true }));
  await ensureContentScript(tabId);
  await sendMessage(tabId, { type: "SET_COLLECTING", on: true });
}

async function stopCollecting() {
  await chrome.storage.session.set({ suppressAutoStart: true });
  await updateState((state) => ({ ...state, collecting: false }));
  const tab = await findMapsTab();
  if (!tab) return;
  try {
    await sendMessage(tab.id, { type: "SET_COLLECTING", on: false });
  } catch {
    /* the Maps tab may still be loading */
  }
}

async function handlePanelOpened() {
  if (panelPromise) return panelPromise;
  panelPromise = (async () => {
    const stored = await chrome.storage.local.get({ collecting: false });
    const session = await chrome.storage.session.get({ suppressAutoStart: false });
    const tabId = await ensureMapsTab(true);
    await waitTabComplete(tabId);
    if (stored.collecting || !session.suppressAutoStart) await beginCollecting();
  })().finally(() => {
    panelPromise = null;
  });
  return panelPromise;
}

function classifyWebsite(raw) {
  if (!raw) return { url: "", social: false };
  let value = String(raw).trim();
  if (!/^https?:\/\//i.test(value)) value = "https://" + value;
  try {
    const url = new URL(value);
    if (!url.hostname.includes(".")) return { url: "", social: false };
    const host = url.hostname.replace(/^www\./, "");
    if (host.startsWith("google.") && url.pathname.startsWith("/maps")) return { url: "", social: false };
    if (SOCIAL_HOSTS.some((domain) => host === domain || host.endsWith("." + domain))) {
      return { url: "", social: true };
    }
    return { url: url.href, social: false };
  } catch {
    return { url: "", social: false };
  }
}

function friendlyFetchError(error) {
  const message = String(error?.message || error || "");
  if (/timed out|abort/i.test(message)) return "Timed out";
  if (/403|401|429/.test(message)) return "Site blocked the request";
  return "Site did not load";
}

async function fetchPage(url) {
  const controller = new AbortController();
  activeFetch = controller;
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      credentials: "omit",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const type = response.headers.get("content-type") || "";
    if (/pdf|image|audio|video/.test(type)) throw new Error("Not a page");
    const text = await response.text();
    return text.slice(0, 1500000);
  } finally {
    clearTimeout(timer);
    if (activeFetch === controller) activeFetch = null;
  }
}

async function findEmailOnSite(website) {
  const homeHtml = await fetchPage(website);
  const homeEmails = extractEmails(homeHtml);
  if (homeEmails.length) {
    return { email: pickPrimary(homeEmails), allEmails: homeEmails, emailSource: "homepage" };
  }
  const links = findContactLinks(homeHtml, website);
  for (const link of links) {
    if (stopRequested) break;
    await sleep(300);
    try {
      const html = await fetchPage(link);
      const emails = extractEmails(html);
      if (emails.length) {
        return { email: pickPrimary(emails), allEmails: emails, emailSource: "contact page" };
      }
    } catch {
      /* try the next contact link */
    }
  }
  return { email: "", allEmails: [], emailSource: "" };
}

async function readLeadFromMaps(tabId, lead) {
  await ensureContentScript(tabId);
  try {
    const response = await sendMessage(
      tabId,
      { type: "OPEN_AND_READ", mapsUrl: lead.mapsUrl, name: lead.name },
      18000
    );
    if (response?.details) return response.details;
  } catch {
    /* a navigation can close the message channel */
  }
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && !stopRequested) {
    await sleep(500);
    try {
      await ensureContentScript(tabId);
      const response = await sendMessage(tabId, { type: "READ_PANEL" }, 3000);
      if (response?.details && namesMatch(response.details.name, lead.name)) return response.details;
    } catch {
      /* Maps is still loading */
    }
  }
  return null;
}

function patchLead(id, fields, emailRun) {
  return updateState((state) => {
    const leads = state.leads.map((lead) => (lead.id === id ? { ...lead, ...fields } : lead));
    return { ...state, leads, emailRun: emailRun || state.emailRun };
  });
}

async function runEmailQueue() {
  stopRequested = false;
  pauseRequested = false;
  await stopCollecting();
  const snapshot = await chrome.storage.local.get({ leads: [] });
  const pending = snapshot.leads.filter((lead) => !lead.email);
  if (!pending.length) {
    await updateState((state) => ({ ...state, emailRun: idleEmailRun() }));
    return;
  }

  const tabId = await ensureMapsTab(true);
  await waitTabComplete(tabId);

  for (let index = 0; index < pending.length; index += 1) {
    while (pauseRequested && !stopRequested) await sleep(200);
    if (stopRequested) break;
    const lead = pending[index];
    const run = {
      active: true,
      paused: false,
      current: index + 1,
      total: pending.length,
      name: lead.name,
    };
    await patchLead(lead.id, { status: "checking", error: "" }, run);

    try {
      let website = lead.website;
      let phone = lead.phone;
      let mapsEmail = "";
      if (!website) {
        const details = await readLeadFromMaps(tabId, lead);
        if (stopRequested) break;
        if (details && namesMatch(details.name, lead.name)) {
          website = details.website || website;
          phone = details.phone || phone;
          mapsEmail = details.email || "";
        }
      }

      if (mapsEmail) {
        await patchLead(lead.id, {
          phone,
          website,
          email: mapsEmail,
          emailSource: "maps",
          status: "found",
          error: "",
        });
        continue;
      }

      const classified = classifyWebsite(website);
      if (!classified.url) {
        await patchLead(lead.id, {
          phone,
          website: website || "",
          status: "no_website",
          error: classified.social ? "Maps only lists a social page" : "No website on Maps",
        });
        continue;
      }

      const found = await findEmailOnSite(classified.url);
      if (stopRequested) break;
      if (found.email) {
        await patchLead(lead.id, {
          phone,
          website: classified.url,
          email: found.email,
          allEmails: found.allEmails,
          emailSource: found.emailSource,
          status: "found",
          error: "",
        });
      } else {
        await patchLead(lead.id, {
          phone,
          website: classified.url,
          status: "no_email",
          error: "No email on website",
        });
      }
    } catch (error) {
      if (stopRequested) break;
      await patchLead(lead.id, { status: "error", error: friendlyFetchError(error) });
    }
    await sleep(600);
  }

  await updateState((state) => ({
    ...state,
    leads: state.leads.map((lead) =>
      lead.status === "checking" ? { ...lead, status: lead.email ? "found" : "saved" } : lead
    ),
    emailRun: idleEmailRun(),
  }));
}

function startEmailQueue() {
  if (queuePromise) return queuePromise;
  queuePromise = runEmailQueue().finally(() => {
    queuePromise = null;
    stopRequested = false;
    pauseRequested = false;
  });
  return queuePromise;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ emailRun: idleEmailRun() });
});

chrome.storage.local.get({ emailRun: idleEmailRun() }, (data) => {
  if (data.emailRun?.active) chrome.storage.local.set({ emailRun: idleEmailRun() });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  handlePanelOpened().catch((error) => console.error(error));
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url || !isMapsUrl(tab.url)) return;
  chrome.scripting
    .executeScript({ target: { tabId }, files: ["lib/parse-lead.js", "content/maps.js"] })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "CONTENT_READY") {
    chrome.storage.local.get({ collecting: false }, (data) => {
      sendResponse({ collecting: !!data.collecting });
    });
    return true;
  }

  if (message.type === "PANEL_OPENED") {
    handlePanelOpened()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "START_COLLECTING") {
    beginCollecting()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "STOP_COLLECTING") {
    stopCollecting()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "UPSERT_LEADS") {
    upsertLeads(message.leads || [])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "FIND_EMAILS") {
    startEmailQueue().catch((error) => console.error(error));
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "PAUSE_EMAILS") {
    pauseRequested = true;
    updateState((state) => ({
      ...state,
      emailRun: { ...state.emailRun, paused: true },
    }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "RESUME_EMAILS") {
    pauseRequested = false;
    updateState((state) => ({
      ...state,
      emailRun: { ...state.emailRun, paused: false },
    }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "STOP_EMAILS") {
    stopRequested = true;
    pauseRequested = false;
    activeFetch?.abort();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CLEAR_LEADS") {
    stopRequested = true;
    pauseRequested = false;
    activeFetch?.abort();
    updateState((state) => ({ ...state, leads: [], emailRun: idleEmailRun() }))
      .then(async () => {
        const tab = await findMapsTab();
        if (tab) {
          try {
            await sendMessage(tab.id, { type: "RESET_SEEN" });
          } catch {
            /* ignore */
          }
        }
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "FOCUS_LEAD") {
    if (queuePromise) {
      sendResponse({ ok: false, error: "Email lookup is running" });
      return;
    }
    ensureMapsTab(true)
      .then(async (tabId) => {
        await ensureContentScript(tabId);
        await sendMessage(tabId, { type: "OPEN_AND_READ", mapsUrl: message.mapsUrl, name: message.name });
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
