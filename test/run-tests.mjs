import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { cleanEmail, extractEmails, findContactLinks, pickPrimary } from "../lib/extract-email.js";

const sandbox = { URL, decodeURIComponent };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("../lib/parse-lead.js", import.meta.url), "utf8"), sandbox);
const { placeKey, parseCardText, unwrapGoogleUrl, namesMatch } = sandbox.LeadParse;

const placeUrl =
  "https://www.google.com/maps/place/Sunrise+Dental/@25.08,55.14,17z/data=!3m1!4b1!4m6!3m5!1s0x3e5f43496ad9c645:0xbde28d0c4e7d8c01!8m2!3d25.08!4d55.14";
assert.equal(placeKey(placeUrl), "0x3e5f43496ad9c645:0xbde28d0c4e7d8c01");
assert.equal(
  placeKey("https://www.google.com/maps/place/Sunrise+Dental/@25,55,17z"),
  "sunrise dental"
);
assert.equal(namesMatch("Sunrise Dental", "sunrise dental"), true);

const card = parseCardText(
  "Sunrise Dental",
  "Sunrise Dental\n4.6\n(328)\nDentist\nOpen\nCloses 9 PM\n12 Marina Walk, Dubai"
);
assert.equal(card.rating, "4.6");
assert.equal(card.reviewCount, "328");
assert.equal(card.category, "Dentist");
assert.equal(card.address, "12 Marina Walk, Dubai");

const inline = parseCardText("Cafe Nova", "4.8(90) · Cafe · 5 Beach Road, Dubai");
assert.equal(inline.rating, "4.8");
assert.equal(inline.reviewCount, "90");
assert.equal(inline.category, "Cafe");
assert.equal(inline.address, "5 Beach Road, Dubai");

assert.equal(
  unwrapGoogleUrl("https://www.google.com/url?q=https%3A%2F%2Fclinic.example%2F&sa=D"),
  "https://clinic.example/"
);

const html = `
  <a href="mailto:info@clinic.example">Email</a>
  <a href="/contact">Contact</a>
  <img src="logo@2x.png">
  <p>sentry@wixpress.com and owner@gmail.com</p>
`;
const emails = extractEmails(html);
assert.deepEqual(emails, ["info@clinic.example", "owner@gmail.com"]);
assert.equal(pickPrimary(emails), "info@clinic.example");
assert.equal(cleanEmail("name@2x.png"), "");
assert.deepEqual(findContactLinks(html, "https://clinic.example/"), ["https://clinic.example/contact"]);

const obfuscated = extractEmails("<p>hello [at] studio.example</p>");
assert.deepEqual(obfuscated, ["hello@studio.example"]);

console.log("All parser and email tests passed.");
