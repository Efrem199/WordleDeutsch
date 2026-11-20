/*
 * Пояснения существительных из немецкого Wiktionary через MediaWiki API.
 * Лицензия текстов: CC BY-SA 4.0.
 */
(function (root) {
  const CACHE_KEY = "wordle-deutsch-definitions-v4";
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

  function findIllustration(node) {
    const figures = node.matches("figure") ? [node] : node.querySelectorAll("figure");
    for (const figure of figures) {
      const link = figure.querySelector('a.mw-file-description[href^="/wiki/Datei:"]');
      const image = link?.querySelector("img[src]");
      if (!image || (image.hasAttribute("width") && Number(image.getAttribute("width")) < 100)) continue;
      const src = image.getAttribute("src");
      if (!/^(?:https:)?\/\/(?:thumb|upload)\.wikimedia\.org\/wikipedia\//.test(src)) continue;
      const thumb = new URL(src, WIKTIONARY);
      const scaled = /^(\/wikipedia\/[^/]+)\/thumb\/(.+)\/[^/]+$/.exec(thumb.pathname);
      const full = scaled ? "https://upload.wikimedia.org" + scaled[1] + "/" + scaled[2] : thumb.href;
      const description = figure.querySelector("figcaption")?.textContent
        .replace(/^\s*\[[\d.,– -]+\]\s*/, "").replace(/\s+/g, " ").trim() || "";
      return { thumb: thumb.href, full, description, source: "Wiktionary",
        page: new URL(link.getAttribute("href"), WIKTIONARY).href };
    }
    return null;
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
        section = { heading, pos, defs: [], lemma: null, image: null };
        sections.push(section);
      } else if (section) {
        if (section.pos.includes("Substantiv") && node.matches("p") && node.textContent.trim() === "Bedeutungen:") {
          const list = node.nextElementSibling;
          if (list?.matches("dl")) {
            section.defs = [...list.querySelectorAll(":scope > dd")].map(plainDefinition).filter(Boolean);
          }
        }
        if (!section.lemma) section.lemma = lemmaTarget(node);
        if (!section.image && section.pos.includes("Substantiv")) section.image = findIllustration(node);
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
    const image = (common.length ? common : nouns).find((noun) => noun.image)?.image || null;
    return { wortart: defs.length ? "Substantiv" : "", defs, lemma, image };
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
    const result = { word, wortart: "", defs: [], url: pageUrl(title), ok: false, image: null };
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
        if (!result.image && parsed.image) result.image = { title, ...parsed.image };
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

  const WIKIPEDIA = "https://de.wikipedia.org";
  const IMG_CACHE_KEY = "wordle-deutsch-images-v3";
  const IMG_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

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

  async function fetchImageMetadata(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function queryPageImage(title) {
    const params = new URLSearchParams({
      action: "query", prop: "pageimages|pageprops|description|info", inprop: "url",
      piprop: "thumbnail|original", pithumbsize: "320", redirects: "1",
      titles: title, format: "json", formatversion: "2", origin: "*",
    });
    const data = await fetchImageMetadata(WIKIPEDIA + "/w/api.php?" + params);
    const page = data?.query?.pages?.[0];
    if (!page) throw new Error("Wikipedia did not return page image metadata.");
    if (page.missing || Object.hasOwn(page.pageprops || {}, "disambiguation")) return null;
    return { thumb: page.thumbnail?.source, full: page.original?.source,
      page: page.fullurl, description: page.description };
  }

  async function querySummaryImage(title) {
    const data = await fetchImageMetadata(WIKIPEDIA + "/api/rest_v1/page/summary/" + encodeURIComponent(title));
    if (!data || data.type === "disambiguation") return null;
    return { thumb: data.thumbnail?.source, full: data.originalimage?.source,
      page: data.content_urls?.desktop?.page, description: data.description };
  }

  /**
   * Картинка и подпись из статьи Википедии (если есть).
   * Возвращает { title, description, thumb, full, page } или null.
   * Пропускает begriffsklärung (несколько значений), чтобы не показать случайную картинку.
   */
  async function getWikiImage(word) {
    const cached = loadImageCache()[word];
    if (cached?.image && Date.now() - cached.savedAt < IMG_CACHE_TTL) return cached.image;

    const title = capitalized(word);
    let metadata;
    try {
      metadata = await queryPageImage(title);
    } catch {
      try {
        metadata = await querySummaryImage(title);
      } catch {
        return null;
      }
    }
    if (!metadata?.thumb && !metadata?.full) return null;
    const image = {
      title,
      description: metadata.description || "",
      thumb: metadata.thumb || metadata.full,
      full: metadata.full || metadata.thumb,
      page: metadata.page || WIKIPEDIA + "/wiki/" + encodeURIComponent(title),
    };
    saveImageCache({ ...loadImageCache(), [word]: { savedAt: Date.now(), image } });
    return image;
  }

  const api = { getExplanation, parseWiktionary, getWikiImage };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WordExplain = api;
})(typeof self !== "undefined" ? self : this);
