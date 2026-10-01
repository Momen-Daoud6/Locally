const collectBtn = document.querySelector("#collectBtn");
const collectLabel = collectBtn.querySelector(".btn-label");
const mapsBtn = document.querySelector("#mapsBtn");
const findBtn = document.querySelector("#findBtn");
const findLabel = findBtn.querySelector(".btn-label");
const pauseBtn = document.querySelector("#pauseBtn");
const pauseLabel = pauseBtn.querySelector(".btn-label");
const stopBtn = document.querySelector("#stopBtn");
const exportBtn = document.querySelector("#exportBtn");
const clearBtn = document.querySelector("#clearBtn");
const filterInput = document.querySelector("#filterInput");
const statusLine = document.querySelector("#statusLine");
const queryLine = document.querySelector("#queryLine");
const list = document.querySelector("#list");
const collectPill = document.querySelector("#collectPill");
const idleActions = document.querySelector("#idleActions");
const runActions = document.querySelector("#runActions");
const progressWrap = document.querySelector("#progressWrap");
const progressBar = document.querySelector("#progressBar");
const progressHost = document.querySelector("#progressHost");
const progressName = document.querySelector("#progressName");
const progressCount = document.querySelector("#progressCount");
const kpiBusinesses = document.querySelector("#kpiBusinesses");
const kpiEmails = document.querySelector("#kpiEmails");
const kpiMissing = document.querySelector("#kpiMissing");

let current = { leads: [], collecting: false, emailRun: idleRun() };
let filter = "";
let segment = "all";

function idleRun() {
  return { active: false, paused: false, current: 0, total: 0, name: "" };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function icon(paths) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}

const ICONS = {
  pin: icon('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
  phone: icon('<path d="M22 16.9v2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 3.1 4.2 2 2 0 0 1 5.1 2h2a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.6 2.6.7A2 2 0 0 1 22 16.9z"/>'),
  globe: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>'),
  star: icon('<path d="m12 3 2.6 5.4 6 .9-4.3 4.2 1 5.9L12 16.8 6.7 19.4l1-5.9L3.4 9.3l6-.9z"/>'),
  copy: icon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  check: icon('<path d="m5 12 5 5L20 7"/>'),
  external: icon('<path d="M14 5h5v5"/><path d="M19 5 10 14"/><path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5"/>'),
  alert: icon('<path d="M12 8v5"/><path d="M12 17h.01"/><path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/>'),
  spinner: `<svg class="icon spinner" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>`,
};

function hostOf(website) {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website || "";
  }
}

function statusView(lead) {
  if (lead.status === "checking") return { text: "Looking up", className: "checking", glyph: ICONS.spinner };
  if (lead.email) return { text: "Email found", className: "found", glyph: ICONS.check };
  if (lead.status === "no_website") return { text: lead.error || "No website on Maps", className: "warn", glyph: ICONS.alert };
  if (lead.status === "no_email") return { text: "No email on website", className: "warn", glyph: ICONS.alert };
  if (lead.status === "error") return { text: lead.error || "Could not open site", className: "bad", glyph: ICONS.alert };
  return { text: "Saved", className: "saved", glyph: "" };
}

function sourceLabel(source) {
  if (source === "maps") return "From Google Maps";
  if (source === "homepage") return "From homepage";
  if (source === "contact page") return "From contact page";
  return "";
}

function filteredLeads() {
  const query = filter.trim().toLowerCase();
  return (current.leads || []).filter((lead) => {
    if (segment === "email" && !lead.email) return false;
    if (segment === "missing" && lead.email) return false;
    if (!query) return true;
    return [lead.name, lead.category, lead.address, lead.phone, lead.website, lead.email, lead.searchQuery]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function fact(glyph, html) {
  return `<li>${glyph}<span>${html}</span></li>`;
}

function render() {
  const leads = current.leads || [];
  const run = current.emailRun || idleRun();
  const missing = leads.filter((lead) => !lead.email).length;
  const found = leads.length - missing;
  const queries = [...new Set(leads.map((lead) => lead.searchQuery).filter(Boolean))];

  document.querySelector(".app").classList.toggle("is-running", !!run.active);
  collectBtn.dataset.mode = current.collecting ? "stop" : "start";
  collectLabel.textContent = current.collecting ? "Stop collecting" : "Start collecting";
  collectBtn.disabled = !!run.active;
  collectPill.hidden = !current.collecting;
  findLabel.textContent = missing ? `Find emails (${missing})` : "Find emails";
  findBtn.disabled = !!run.active || missing === 0;
  idleActions.hidden = !!run.active;
  runActions.hidden = !run.active;
  pauseBtn.dataset.mode = run.paused ? "resume" : "pause";
  pauseLabel.textContent = run.paused ? "Resume" : "Pause";
  exportBtn.disabled = leads.length === 0;
  clearBtn.disabled = leads.length === 0 || !!run.active;
  progressWrap.hidden = !run.active;

  const percent = run.active && run.total ? Math.round((run.current / run.total) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  progressHost.setAttribute("aria-valuenow", String(percent));
  progressName.textContent = run.paused ? `Paused on ${run.name || "a business"}` : `Checking ${run.name || "a business"}`;
  progressCount.textContent = run.total ? `${run.current} of ${run.total}` : "";

  statusLine.className = "status";
  if (run.active) {
    statusLine.classList.add("busy");
    statusLine.textContent = run.paused
      ? "Lookup is paused. Resume when you want the next website checked."
      : "Finding emails in the Maps tab. You can pause or stop.";
  } else if (current.collecting) {
    statusLine.classList.add("live");
    statusLine.textContent = "Collecting. Scroll the results list on the left.";
  } else if (leads.length) {
    statusLine.textContent = missing
      ? "List saved. Find emails when you are done scrolling."
      : "Every business in this list already has an email.";
  } else {
    statusLine.textContent = "Search on Google Maps, then scroll the results list.";
  }

  if (queries.length === 1) {
    queryLine.hidden = false;
    queryLine.textContent = `Search: ${queries[0]}`;
  } else {
    queryLine.hidden = true;
    queryLine.textContent = "";
  }

  kpiBusinesses.textContent = String(leads.length);
  kpiEmails.textContent = String(found);
  kpiMissing.textContent = String(missing);

  const visible = filteredLeads();
  const scrollTop = list.scrollTop;
  if (!leads.length) {
    list.innerHTML = `<section class="empty-card">
      <h2>No businesses yet</h2>
      <p>The list fills as you move through Maps results.</p>
      <ol class="steps">
        <li><span class="step-num">01</span><span>Search on Google Maps.</span></li>
        <li><span class="step-num">02</span><span>Scroll the results list, not the map.</span></li>
        <li><span class="step-num">03</span><span>Find emails after the list looks right.</span></li>
      </ol>
    </section>`;
  } else if (!visible.length) {
    list.innerHTML = `<p class="empty-note">${segment === "missing" && !missing ? "Every business already has an email." : "Nothing matches that filter."}</p>`;
  } else {
    list.innerHTML = visible
      .map((lead) => {
        const status = statusView(lead);
        const reviewLabel = lead.reviewCount ? `${Number(lead.reviewCount).toLocaleString()} reviews` : "";
        const source = sourceLabel(lead.emailSource);
        const facts = [
          lead.address ? fact(ICONS.pin, esc(lead.address)) : "",
          lead.phone ? fact(ICONS.phone, `<a href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a>`) : "",
          lead.website ? fact(ICONS.globe, `<a href="${esc(lead.website)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(lead.website))}</a>`) : "",
        ].join("");
        const emailRow = lead.email
          ? `<div class="email-row"><span class="email found">${esc(lead.email)}</span><button class="icon-btn" type="button" data-copy="${esc(lead.email)}" aria-label="Copy ${esc(lead.email)}">${ICONS.copy}</button></div>${source ? `<p class="source">${esc(source)}</p>` : ""}`
          : "";
        return `<article class="lead${lead.status === "checking" ? " checking" : ""}" data-id="${esc(lead.id)}">
          <div class="lead-top">
            <h2 class="name">${esc(lead.name)}</h2>
            ${lead.rating ? `<span class="rating">${ICONS.star}${esc(lead.rating)}</span>` : ""}
            <button class="icon-btn" type="button" data-open="true" aria-label="Open ${esc(lead.name)} in Google Maps" title="Open in Google Maps"${run.active ? " disabled" : ""}>${ICONS.external}</button>
          </div>
          ${lead.category || reviewLabel ? `<p class="meta">${esc([lead.category, reviewLabel].filter(Boolean).join(" · "))}</p>` : ""}
          ${facts ? `<ul class="facts">${facts}</ul>` : ""}
          <span class="chip ${status.className}">${status.glyph}${esc(status.text)}</span>
          ${emailRow}
        </article>`;
      })
      .join("");
  }
  list.scrollTop = scrollTop;
}

async function refresh() {
  current = await chrome.storage.local.get({
    leads: [],
    collecting: false,
    emailRun: idleRun(),
  });
  render();
}

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra }).then((response) => {
    if (response?.ok === false && response.error) statusLine.textContent = response.error;
    return response;
  });
}

function openLead(id) {
  if (current.emailRun?.active) return;
  const lead = current.leads.find((item) => item.id === id);
  if (!lead) return;
  send("FOCUS_LEAD", { mapsUrl: lead.mapsUrl, name: lead.name });
}

collectBtn.addEventListener("click", () => {
  send(current.collecting ? "STOP_COLLECTING" : "START_COLLECTING");
});

mapsBtn.addEventListener("click", () => send("PANEL_OPENED"));
findBtn.addEventListener("click", () => send("FIND_EMAILS"));

pauseBtn.addEventListener("click", () => {
  send(current.emailRun?.paused ? "RESUME_EMAILS" : "PAUSE_EMAILS");
});

stopBtn.addEventListener("click", () => send("STOP_EMAILS"));

clearBtn.addEventListener("click", () => {
  if (!current.leads.length) return;
  if (!confirm("Remove all saved leads?")) return;
  send("CLEAR_LEADS");
});

exportBtn.addEventListener("click", () => {
  const columns = [
    ["name", "Name"],
    ["category", "Category"],
    ["rating", "Rating"],
    ["reviewCount", "Reviews"],
    ["address", "Address"],
    ["phone", "Phone"],
    ["website", "Website"],
    ["email", "Email"],
    ["allEmails", "Other emails"],
    ["emailSource", "Email source"],
    ["status", "Status"],
    ["error", "Note"],
    ["searchQuery", "Search"],
    ["mapsUrl", "Maps URL"],
  ];
  const lines = [columns.map((column) => column[1]).join(",")];
  for (const lead of current.leads) {
    lines.push(
      columns
        .map(([key]) => {
          const value = key === "allEmails" ? (lead.allEmails || []).filter((item) => item !== lead.email).join("; ") : lead[key];
          const cell = String(value ?? "");
          return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
        })
        .join(",")
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `locally-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

filterInput.addEventListener("input", () => {
  filter = filterInput.value;
  render();
});

document.querySelectorAll("[data-segment]").forEach((button) => {
  button.addEventListener("click", () => {
    segment = button.dataset.segment;
    document.querySelectorAll("[data-segment]").forEach((item) => {
      item.setAttribute("aria-pressed", item === button ? "true" : "false");
    });
    render();
  });
});

list.addEventListener("click", (event) => {
  const copyBtn = event.target.closest("[data-copy]");
  if (copyBtn) {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard.writeText(copyBtn.dataset.copy).then(() => {
      copyBtn.classList.add("copied");
      copyBtn.setAttribute("aria-label", "Copied");
      copyBtn.innerHTML = ICONS.check;
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.setAttribute("aria-label", `Copy ${copyBtn.dataset.copy}`);
        copyBtn.innerHTML = ICONS.copy;
      }, 1200);
    });
    return;
  }
  if (event.target.closest("a")) return;
  const card = event.target.closest(".lead");
  if (!card) return;
  openLead(card.dataset.id);
});

if (globalThis.chrome?.storage?.local) {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== "local") return;
    refresh();
  });
  refresh().then(() => send("PANEL_OPENED"));
} else {
  render();
}
