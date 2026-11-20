/*
 * Пояснения существительных из немецкого Wiktionary через MediaWiki API.
 * Лицензия текстов: CC BY-SA 4.0.
 */
(function (root) {
  const CACHE_KEY = "wordle-deutsch-definitions-v3";
  const API = "https://de.wiktionary.org/w/api.php";
  const WIKTIONARY = "https://de.wiktionary.org";
  const MAX_DEFS = 3;
  const MAX_LEN = 280;
  const REQUEST_TIMEOUT = 7000;
  const LINK_TO_LEMMA = ".lemmaverweis a[href^='/wiki/'], .grundformverweis-dekl a[href^='/wiki/']";
  const POS_LINK = "a[href^='/wiki/Hilfe:Wortart#']";
  const NAME_TYPES = new Set(["Eigenname", "Vorname", "Nachname", "Toponym", "Straßenname", "Ortsname"]);

  function plainDefinition(term) {
    term.querySelectorAll(".reference, .mw-editsection, script, style").forEach((node) => node.remove());
    const match = /^\[[\d., –-]+\]\s*(.*)$/s.exec(term.textContent.trim());
    const text = match?.[1].replace(/\s+/g, " ").trim().replace(/\[(\d+(?:[., –-]+\d+)*)\]/g, (_, nums) =>
      (/[,–-]/.test(nums) ? "Bedeutungen " : "Bedeutung ") + nums) || "";
    return text.length > MAX_LEN ? text.slice(0, MAX_LEN - 1) + "…" : text;
  }

  function sectionHeading(node) {
    return node.matches("h2, h3") ? node : node.querySelector(":scope > h2, :scope > h3");
  }

  function lemmaTarget(node) {
    const link = node.querySelector(LINK_TO_LEMMA);
    if (!link) return null;
    const url = new URL(link.getAttribute("href"), WIKTIONARY);
    return { title: decodeURIComponent(url.pathname.slice("/wiki/".length)).replaceAll("_", " "),
      anchor: decodeURIComponent(url.hash.slice(1)) };
  }

  function parseWiktionary(html, anchor = "") {
    // A template is inert. The HTML and its links are never inserted into the UI.
    const template = document.createElement("template");
    template.innerHTML = html;
    const content = template.content.querySelector(".mw-parser-output") || template.content;
    let german = false;
    let section = null;
    const sections = [];
    for (const node of content.children) {
      const heading = sectionHeading(node);
      if (heading?.tagName === "H2") {
        if (german) break;
        german = !!heading.querySelector('a[href="/wiki/Wiktionary:Deutsch"]');
      }
      if (!german) continue;
      if (heading?.tagName === "H3") {
        const pos = [...heading.querySelectorAll(POS_LINK)].map((link) => link.textContent.trim());
        section = { heading, pos, defs: [], lemma: null };
        sections.push(section);
      } else if (section) {
        if (section.pos.includes("Substantiv") && node.matches("p") && node.textContent.trim() === "Bedeutungen:") {
          const list = node.nextElementSibling;
          if (list?.matches("dl")) {
            section.defs = [...list.querySelectorAll(":scope > dd")].map(plainDefinition).filter(Boolean);
          }
        }
        if (!section.lemma) section.lemma = lemmaTarget(node);
      }
    }

    const matching = anchor && sections.find(({ heading }) =>
      heading.id === anchor || [...heading.querySelectorAll("[id]")].some((node) => node.id === anchor));
    const selected = matching ? [matching] : sections;
    const nouns = selected.filter(({ pos }) => pos.includes("Substantiv"));
    const common = nouns.filter(({ pos, heading }) => !pos.some((name) => NAME_TYPES.has(name))
      || /\bauch\b/i.test(heading.textContent));
    const collect = (entries) => [...new Set(entries.flatMap((noun) => noun.defs))].slice(0, MAX_DEFS);
    const commonDefs = collect(common);
    const defs = commonDefs.length ? commonDefs : collect(nouns);
    const lemma = selected.find((entry) => entry.lemma)?.lemma || null;
    return { wortart: defs.length ? "Substantiv" : "", defs, lemma };
  }

  function capitalized(word) {
    return (word[0] === "ß" ? "ẞ" : word[0].toUpperCase()) + word.slice(1);
  }

  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveCache(c) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) {
      /* переполнение хранилища — не критично */
    }
  }

  function pageUrl(title, anchor = "") {
    const page = WIKTIONARY + "/wiki/" + encodeURIComponent(title.replaceAll(" ", "_"));
    return anchor ? page + "#" + encodeURIComponent(anchor) : page;
  }

  async function fetchTitle(title, signal) {
    const query = new URLSearchParams({
      action: "parse", prop: "text", page: title, format: "json", formatversion: "2",
      redirects: "1", disableeditsection: "1", disablelimitreport: "1", origin: "*",
    });
    const res = await fetch(API + "?" + query, { signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    return json.parse;
  }

  /**
   * Возвращает { word, wortart, defs, url, ok }.
   * Слово в игре — существительное, поэтому ищем его с заглавной буквы. Если статья — отсылка
   * (Jacht → Yacht), берём значения основной формы; слово в подписи остаётся прежним.
   */
  async function getExplanation(word) {
    const cached = loadCache()[word];
    if (cached) return cached;

    const title = capitalized(word);
    const result = { word, wortart: "", defs: [], url: pageUrl(title), ok: false };
    const visited = new Set();
    let target = { title, anchor: "" };
    try {
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT);
      while (target && visited.size < 3) {
        const key = pageUrl(target.title, target.anchor);
        if (visited.has(key)) break;
        visited.add(key);
        const page = await fetchTitle(target.title, signal);
        if (!page?.text) break;
        const parsed = parseWiktionary(page.text, target.anchor);
        if (parsed.defs.length) {
          const explained = { ...result, wortart: parsed.wortart, defs: parsed.defs,
            url: pageUrl(page.title || target.title, target.anchor), ok: true };
          saveCache({ ...loadCache(), [word]: explained });
          return explained;
        }
        target = parsed.lemma;
      }
    } catch { /* Сбои не сохраняются в кэше. */ }
    return result;
  }

  /* ---------- Картинки из Википедии ---------- */

  const IMG_CACHE_KEY = "wordle-deutsch-images-v2";

  function loadImageCache() {
    try {
      return JSON.parse(localStorage.getItem(IMG_CACHE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveImageCache(c) {
    try {
      localStorage.setItem(IMG_CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* не критично */ }
  }

  async function fetchSummary(title, signal) {
    const url = "https://de.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title);
    const res = await fetch(url, { headers: { accept: "application/json" }, signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  /**
   * Картинка и подпись из статьи Википедии (если есть).
   * Возвращает { title, description, thumb, full, page } или null.
   * Пропускает begriffsklärung (несколько значений), чтобы не показать случайную картинку.
   */
  async function getWikiImage(word) {
    const cache = loadImageCache();
    if (Object.prototype.hasOwnProperty.call(cache, word)) return cache[word];

    const cap = capitalized(word);
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT);
    for (const title of [cap, word]) {
      let s;
      try {
        s = await fetchSummary(title, signal);
      } catch (e) {
        return null; // сеть недоступна — без кэширования
      }
      if (!s || s.type === "disambiguation" || !s.thumbnail || !s.thumbnail.source) continue;
      const result = {
        title: cap, // подпись — то слово, что выпало в игре, а не название статьи после редиректа
        description: s.description || "",
        thumb: s.thumbnail.source,
        full: (s.originalimage && s.originalimage.source) || s.thumbnail.source,
        page: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || "https://de.wikipedia.org/wiki/" + encodeURIComponent(cap),
      };
      saveImageCache({ ...loadImageCache(), [word]: result });
      return result;
    }
    saveImageCache({ ...loadImageCache(), [word]: null });
    return null;
  }

  const api = { getExplanation, parseWiktionary, getWikiImage };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WordExplain = api;
})(typeof self !== "undefined" ? self : this);
