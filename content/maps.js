if (globalThis.__MAPS_EMAIL_FINDER__) {
  /* Already injected. */
} else {
  globalThis.__MAPS_EMAIL_FINDER__ = true;

  const { placeKey, parseCardText, namesMatch, unwrapGoogleUrl } = globalThis.LeadParse;
  const BAD_NAME = /^(directions|save|share|website|call|results|sponsored|الموقع|اتصال|مشاركة)$/i;

  let collecting = false;
  let observer = null;
  let scanTimer = 0;
  const seenSignatures = new Map();
  let lastVisible = [];

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanName(raw) {
    let name = String(raw || "")
      .split("\n")[0]
      .replace(/\s+/g, " ")
      .trim();
    name = name.replace(/\s+\d[.,]\d\s+stars?.*$/i, "");
    name = name.replace(/\s+\d[.,]\d\s+نجوم.*$/, "");
    return name.slice(0, 160);
  }

  function searchQuery() {
    return document.querySelector("#searchboxinput")?.value?.trim() || "";
  }

  function starLabelFrom(root) {
    for (const element of root.querySelectorAll("[aria-label]")) {
      const label = element.getAttribute("aria-label") || "";
      if (/\d/.test(label) && /star|نجم/i.test(label)) return label;
    }
    return "";
  }

  function phoneFrom(root) {
    const control = root.querySelector('[data-item-id^="phone:tel:"], a[href^="tel:"]');
    if (!control) return "";
    const itemId = control.getAttribute("data-item-id") || "";
    if (itemId.startsWith("phone:tel:")) {
      try {
        return decodeURIComponent(itemId.slice("phone:tel:".length));
      } catch {
        return itemId.slice("phone:tel:".length);
      }
    }
    return (control.getAttribute("href") || "").replace(/^tel:/i, "");
  }

  function websiteFrom(root) {
    const authority = root.querySelector('[data-item-id="authority"], a[data-item-id^="authority"]');
    if (authority) {
      const href = authority.getAttribute("href") || authority.href || "";
      return unwrapGoogleUrl(href);
    }
    for (const link of root.querySelectorAll("a[href]")) {
      try {
        const url = new URL(link.href);
        const host = url.hostname.replace(/^www\./, "");
        if (!/google\.|gstatic\.|googleusercontent\.|ggpht\./.test(host)) return url.href;
      } catch {
        /* ignore bad links */
      }
    }
    return "";
  }

  function emailFrom(root) {
    const mailto = root.querySelector('a[href^="mailto:"]');
    if (mailto) {
      try {
        return decodeURIComponent(mailto.getAttribute("href").replace(/^mailto:/i, "").split("?")[0]);
      } catch {
        return mailto.getAttribute("href").replace(/^mailto:/i, "").split("?")[0];
      }
    }
    for (const element of root.querySelectorAll("[aria-label], [data-item-id]")) {
      const label = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-item-id") || ""}`;
      if (!/mail|email|بريد/i.test(label)) continue;
      const match = label.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
      if (match) return match[0];
    }
    return "";
  }

  function cardFromLink(link) {
    let node = link.parentElement;
    let chosen = node || link;
    for (let depth = 0; depth < 5 && node; depth += 1) {
      if (node.querySelectorAll('a[href*="/maps/place/"]').length > 1) break;
      chosen = node;
      node = node.parentElement;
    }
    return chosen;
  }

  function leadFromArticle(article, query, link = article.querySelector('a[href*="/maps/place/"]')) {
    if (!link) return null;
    const name = cleanName(link.getAttribute("aria-label") || article.innerText || "");
    if (!name || BAD_NAME.test(name)) return null;
    const id = placeKey(link.href);
    if (!id) return null;
    const facts = parseCardText(name, article.innerText || "");
    const fromStar = parseCardText(name, starLabelFrom(article));
    return {
      id,
      name,
      category: facts.category,
      rating: fromStar.rating || facts.rating,
      reviewCount: fromStar.reviewCount || facts.reviewCount,
      address: facts.address,
      phone: phoneFrom(article),
      website: websiteFrom(article),
      email: emailFrom(article),
      mapsUrl: link.href,
      searchQuery: query,
    };
  }

  function readPlacePanel() {
    const main = document.querySelector('div[role="main"]');
    if (!main) return null;
    const heading = [...main.querySelectorAll("h1")].find(isVisible);
    const name = cleanName(heading?.textContent || "");
    if (!name || BAD_NAME.test(name)) return null;

    let phone = "";
    let website = "";
    let address = "";
    for (const element of main.querySelectorAll("[data-item-id]")) {
      const itemId = element.getAttribute("data-item-id") || "";
      if (!phone && itemId.startsWith("phone:tel:")) {
        try {
          phone = decodeURIComponent(itemId.slice("phone:tel:".length));
        } catch {
          phone = itemId.slice("phone:tel:".length);
        }
      } else if (!website && (itemId === "authority" || itemId.startsWith("authority"))) {
        website = unwrapGoogleUrl(element.getAttribute("href") || element.href || "");
      } else if (!address && (itemId === "address" || itemId.startsWith("address"))) {
        address = (element.getAttribute("aria-label") || element.textContent || "")
          .replace(/^address:\s*/i, "")
          .replace(/^العنوان:\s*/, "")
          .replace(/\bcop(y|ied) address\b/gi, "")
          .trim();
      }
    }

    const facts = parseCardText(name, main.innerText.split("\n").slice(0, 18).join("\n"));
    const fromStar = parseCardText(name, starLabelFrom(main));
    const id = placeKey(location.href) || placeKey(`https://www.google.com/maps/place/${encodeURIComponent(name)}`);
    return {
      id,
      name,
      category: facts.category,
      rating: fromStar.rating || facts.rating,
      reviewCount: fromStar.reviewCount || facts.reviewCount,
      address: address || facts.address,
      phone,
      website,
      email: emailFrom(main),
      mapsUrl: location.href,
      searchQuery: searchQuery(),
    };
  }

  function matchKnown(panel) {
    const byId = lastVisible.find((lead) => lead.id === panel.id);
    if (byId) return byId;
    const named = lastVisible.filter((lead) => namesMatch(lead.name, panel.name));
    if (named.length === 1) return named[0];
    if (panel.address) {
      const addressed = named.filter(
        (lead) => lead.address && (lead.address.includes(panel.address) || panel.address.includes(lead.address))
      );
      if (addressed.length === 1) return addressed[0];
    }
    return null;
  }

  function signature(lead) {
    return [
      lead.name,
      lead.category,
      lead.rating,
      lead.reviewCount,
      lead.address,
      lead.phone,
      lead.website,
      lead.email,
      lead.mapsUrl,
    ].join("|");
  }

  function publish(leads) {
    const changed = [];
    for (const lead of leads) {
      const sig = signature(lead);
      if (seenSignatures.get(lead.id) === sig) continue;
      seenSignatures.set(lead.id, sig);
      changed.push(lead);
    }
    if (!changed.length) return;
    chrome.runtime.sendMessage({ type: "UPSERT_LEADS", leads: changed }, () => {
      void chrome.runtime.lastError;
    });
  }

  function scan() {
    if (!collecting) return;
    const query = searchQuery();
    const leads = [];
    const feed = document.querySelector('[role="feed"]');
    const articles = feed ? feed.querySelectorAll('[role="article"]') : [];
    const pushLead = (lead) => {
      if (!lead || leads.some((item) => item.id === lead.id)) return;
      leads.push(lead);
    };
    articles.forEach((article) => pushLead(leadFromArticle(article, query)));
    if (!leads.length && feed) {
      feed.querySelectorAll('a[href*="/maps/place/"]').forEach((link) => {
        pushLead(leadFromArticle(cardFromLink(link), query, link));
      });
    }

    const panel = readPlacePanel();
    if (panel && panel.name !== query) {
      const known = matchKnown(panel);
      if (known) panel.id = known.id;
      const index = leads.findIndex((lead) => lead.id === panel.id || namesMatch(lead.name, panel.name));
      if (index >= 0) {
        leads[index] = {
          ...leads[index],
          phone: panel.phone || leads[index].phone,
          website: panel.website || leads[index].website,
          email: panel.email || leads[index].email,
          address: panel.address || leads[index].address,
          category: panel.category || leads[index].category,
          rating: panel.rating || leads[index].rating,
          reviewCount: panel.reviewCount || leads[index].reviewCount,
        };
      } else if (panel.phone || panel.website || panel.address) {
        leads.push(panel);
      }
    }

    lastVisible = leads;
    if (leads.length) publish(leads);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 350);
  }

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", scheduleScan, true);
    setInterval(() => {
      if (collecting) scheduleScan();
    }, 2000);
  }

  function setCollecting(on) {
    if (on && !collecting) seenSignatures.clear();
    collecting = on;
    if (on) {
      ensureObserver();
      scheduleScan();
    }
  }

  function panelMatches(details, name, key) {
    if (!details?.name) return false;
    if (key && placeKey(location.href) === key) return true;
    if (name && namesMatch(details.name, name)) return true;
    return false;
  }

  async function waitForDetails(name, key) {
    const deadline = Date.now() + 9000;
    let matchedAt = 0;
    while (Date.now() < deadline) {
      const details = readPlacePanel();
      if (panelMatches(details, name, key)) {
        if (!matchedAt) matchedAt = Date.now();
        const waited = Date.now() - matchedAt;
        if (details.website || details.phone || waited > 2500) return details;
      } else {
        matchedAt = 0;
      }
      await delay(200);
    }
    return readPlacePanel();
  }

  function findPlaceLink(mapsUrl, name) {
    const key = placeKey(mapsUrl);
    const links = [...document.querySelectorAll('a[href*="/maps/place/"]')];
    if (key) {
      const byKey = links.find((link) => placeKey(link.href) === key);
      if (byKey) return byKey;
    }
    if (name) {
      const byName = links.find((link) => namesMatch(cleanName(link.getAttribute("aria-label") || ""), name));
      if (byName) return byName;
    }
    return null;
  }

  async function openAndRead(message) {
    const key = placeKey(message.mapsUrl);
    const already = key && placeKey(location.href) === key;
    if (!already) {
      const link = findPlaceLink(message.mapsUrl, message.name);
      if (link) {
        link.scrollIntoView({ block: "center", inline: "nearest" });
        link.click();
      } else if (message.mapsUrl) {
        location.assign(message.mapsUrl);
      }
    }
    return waitForDetails(message.name, key);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "SET_COLLECTING") {
      setCollecting(!!message.on);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "RESET_SEEN") {
      seenSignatures.clear();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "READ_PANEL") {
      sendResponse({ ok: true, details: readPlacePanel() });
      return;
    }
    if (message.type === "OPEN_AND_READ") {
      openAndRead(message)
        .then((details) => sendResponse({ ok: true, details }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
  });

  chrome.runtime.sendMessage({ type: "CONTENT_READY" }, (response) => {
    void chrome.runtime.lastError;
    if (response?.collecting) setCollecting(true);
  });
}
