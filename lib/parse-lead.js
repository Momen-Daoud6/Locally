(function installLeadParse(root) {
  function normalizeDigits(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/٫/g, ".")
      .replace(/٬/g, "");
  }

  function unwrapGoogleUrl(href) {
    if (!href) return "";
    try {
      const url = new URL(href, "https://www.google.com");
      const host = url.hostname.replace(/^www\./, "");
      if (host.startsWith("google.") && (url.pathname === "/url" || url.pathname === "/url/")) {
        const target = url.searchParams.get("q") || url.searchParams.get("url") || "";
        if (target) return unwrapGoogleUrl(target);
      }
      return url.href;
    } catch {
      return String(href);
    }
  }

  function placeKey(url) {
    if (!url) return "";
    try {
      const abs = new URL(url, "https://www.google.com");
      let blob = abs.pathname + abs.search;
      try {
        blob = decodeURIComponent(blob);
      } catch {
        /* keep the raw path */
      }
      const feature = blob.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
      if (feature) return feature[1].toLowerCase();
      const placeId = blob.match(/place_id(?:=|:)(ChIJ[0-9A-Za-z_-]+)/);
      if (placeId) return placeId[1];
      const named = abs.pathname.match(/\/maps\/place\/([^/@]+)/);
      if (named) {
        return decodeURIComponent(named[1]).replace(/\+/g, " ").trim().toLowerCase();
      }
      return "";
    } catch {
      return "";
    }
  }

  function normalizeName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function namesMatch(left, right) {
    const a = normalizeName(left);
    const b = normalizeName(right);
    if (!a || !b) return false;
    return a === b || a.startsWith(b) || b.startsWith(a);
  }

  function isHoursLine(line) {
    return (
      /^(open|closed)\b/i.test(line) ||
      /\b(opens|closes|open until|24 hours)\b/i.test(line) ||
      /مفتوح|مغلق|يفتح|يغلق/.test(line)
    );
  }

  function isNoiseLine(line) {
    return /^(sponsored|ad|إعلان|dine-in|takeout|takeaway|delivery|drive-through|onsite services|online appointments)$/i.test(
      line
    );
  }

  function looksLikeAddress(line) {
    if (line.length < 6) return false;
    if (/,/.test(line)) return true;
    return /\d/.test(line) && /[A-Za-z\u0600-\u06FF]/.test(line);
  }

  function explodeLines(raw) {
    const lines = [];
    for (const line of String(raw || "").split("\n")) {
      if (line.includes("·") || line.includes("•")) lines.push(...line.split(/\s*[·•]\s*/));
      else lines.push(line);
    }
    return lines;
  }

  function parseCardText(name, raw) {
    const text = normalizeDigits(raw);
    const lines = explodeLines(text)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => normalizeName(line) !== normalizeName(name))
      .filter((line) => !isNoiseLine(line));

    let rating = "";
    let reviewCount = "";
    const rest = [];

    for (const line of lines) {
      const both = line.match(/^([0-5][.,]\d)\s*\((\d[\d,]*)\)$/);
      if (both && !rating) {
        rating = both[1].replace(",", ".");
        reviewCount = both[2].replace(/,/g, "");
        continue;
      }
      const onlyRating = line.match(/^([0-5][.,]\d)$/);
      if (onlyRating && !rating) {
        rating = onlyRating[1].replace(",", ".");
        continue;
      }
      const onlyReviews = line.match(/^\((\d[\d,]*)\)$/);
      if (onlyReviews && !reviewCount) {
        reviewCount = onlyReviews[1].replace(/,/g, "");
        continue;
      }
      if (isHoursLine(line)) continue;
      if (/^\$+$/.test(line)) continue;
      rest.push(line);
    }

    if (!rating) {
      const combined = text.match(/([0-5][.,]\d)\s*(?:stars?|نجوم)?\s*\((\d[\d,]*)\)/i);
      if (combined) {
        rating = combined[1].replace(",", ".");
        reviewCount = reviewCount || combined[2].replace(/,/g, "");
      }
    }

    let category = "";
    let address = "";
    for (const line of rest) {
      if (!address && looksLikeAddress(line)) {
        address = line;
        continue;
      }
      if (!category && line.length < 48) {
        category = line;
        continue;
      }
      if (!address) address = line;
    }

    return { rating, reviewCount, category, address };
  }

  root.LeadParse = {
    normalizeDigits,
    unwrapGoogleUrl,
    placeKey,
    namesMatch,
    parseCardText,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
