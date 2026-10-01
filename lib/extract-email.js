const EMAIL_RE = /[a-z0-9][a-z0-9._%+\-]{0,64}@[a-z0-9][a-z0-9.\-]{1,253}\.[a-z]{2,24}/gi;
const ROLE_RE = /^(info|contact|hello|office|sales|enquir|inquir|support|admin|mail|booking|appointments?|reception|frontdesk|team)@/i;
const BAD_LOCAL_RE = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|sentry|wix|wordpress)$/i;
const BAD_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "css", "js", "map", "bmp", "ico", "tif", "tiff", "woff", "woff2"]);
const BLOCKED_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "domain.com",
  "email.com",
  "yourdomain.com",
  "yoursite.com",
  "mysite.com",
  "placeholder.com",
  "sentry.io",
  "wixpress.com",
  "schema.org",
  "w3.org",
  "googleapis.com",
  "gstatic.com",
  "cloudflare.com",
  "godaddy.com",
];
const CONTACT_RE = /(contact-us|contactus|contact|about-us|about|impressum|kontakt|reach-us|get-in-touch|support)/i;

function decodeForEmail(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/&#64;|&#x40;|&commat;/gi, "@")
    .replace(/\s*\[(?:at|@)\]\s*/gi, "@")
    .replace(/\s*\((?:at|@)\)\s*/gi, "@")
    .replace(/\s*\[(?:dot|\.)\]\s*/gi, ".")
    .replace(/\s*\((?:dot|\.)\)\s*/gi, ".")
    .replace(/&amp;/gi, "&");
}

function badDomain(domain) {
  if (domain === "google.com" || domain.endsWith(".google.com")) return true;
  return BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith("." + blocked));
}

export function cleanEmail(raw) {
  if (!raw) return "";
  let value = String(raw).trim().replace(/^mailto:/i, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep the original */
  }
  value = value.split("?")[0].split("#")[0].replace(/^[\s<("']+|[>\s)"',;:.]+$/g, "").toLowerCase();
  if (!value || value.length > 80 || !value.includes("@")) return "";
  const match = value.match(/^[a-z0-9][a-z0-9._%+\-]{0,64}@[a-z0-9][a-z0-9.\-]{1,253}\.[a-z]{2,24}$/);
  if (!match) return "";
  const [local, domain] = value.split("@");
  const tld = domain.split(".").pop();
  if (!local || !domain || BAD_TLDS.has(tld) || BAD_LOCAL_RE.test(local) || badDomain(domain)) return "";
  if (local.includes("..") || domain.includes("..") || domain.startsWith(".") || domain.endsWith(".")) return "";
  return value;
}

export function extractEmails(html) {
  const decoded = decodeForEmail(html);
  const seen = new Set();
  const emails = [];

  function add(raw) {
    const email = cleanEmail(raw);
    if (!email || seen.has(email)) return;
    seen.add(email);
    emails.push(email);
  }

  for (const match of decoded.matchAll(/mailto:([^"'?\s<>]+)/gi)) add(match[1]);
  for (const match of decoded.matchAll(EMAIL_RE)) add(match[0]);
  return emails;
}

export function pickPrimary(emails) {
  return emails.find((email) => ROLE_RE.test(email)) || emails[0] || "";
}

function sameSite(left, right) {
  const a = left.hostname.replace(/^www\./, "");
  const b = right.hostname.replace(/^www\./, "");
  return a === b;
}

function contactScore(url) {
  const path = url.pathname.toLowerCase();
  if (path.includes("contact")) return 3;
  if (/(impressum|kontakt|reach|support)/.test(path)) return 2;
  if (path.includes("about")) return 1;
  return 0;
}

export function findContactLinks(html, baseUrl) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const decoded = decodeForEmail(html);
  const found = [];
  const seen = new Set();
  for (const match of decoded.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let next;
    try {
      next = new URL(match[1], base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(next.protocol)) continue;
    if (!sameSite(base, next)) continue;
    if (!CONTACT_RE.test(next.pathname)) continue;
    next.hash = "";
    const key = next.href;
    if (seen.has(key) || key === base.href) continue;
    seen.add(key);
    found.push(next.href);
  }
  return found.sort((a, b) => contactScore(new URL(b)) - contactScore(new URL(a))).slice(0, 3);
}
