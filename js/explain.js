/*
 * Пояснения слов из немецкого Wiktionary (de.wiktionary.org), через MediaWiki API с CORS (origin=*).
 * Результаты кэшируются в localStorage. Лицензия текстов: CC BY-SA 4.0.
 */
(function (root) {
  const CACHE_KEY = "wordle-deutsch-definitions-v1";
  const API = "https://de.wiktionary.org/w/api.php";

  function cleanWiki(line) {
    let t = line;
    t = t.replace(/<ref[^>]*>.*?<\/ref>/gs, "");
    t = t.replace(/<ref[^>]*\/>/g, "");
    t = t.replace(/\{\{K\|([^}|]*)[^}]*\}\}/g, "($1) ");          // Kontext-Angabe
    for (let i = 0; i < 10 && /\{\{[^{}]*\}\}/.test(t); i++) {    // übrige Vorlagen entfernen
      t = t.replace(/\{\{[^{}]*\}\}/g, "");
    }
    for (let i = 0; i < 5 && /\[\[[^\[\]]*\]\]/.test(t); i++) {   // Links -> Text
      t = t.replace(/\[\[(?:[^\[\]|]*\|)?([^\[\]]*)\]\]/g, "$1");
    }
    t = t.replace(/'{2,}/g, "");                                  // kursiv/fett
    t = t.replace(/\[\d+(?:[,–-]\s*\d+)*\]/g, "");              // [1], [1, 2] Verweise
    t = t.replace(/^:\s*/, "");
    t = t.replace(/\s+/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(").trim();
    return t;
  }

  /** Немецкая секция вики-текста (или null, если её нет). */
  function germanSection(wikitext) {
    let text = wikitext;
    const start = text.search(/==\s*[^=\n]+\(\{\{Sprache\|Deutsch\}\}\)\s*==/);
    if (start >= 0) {
      text = text.slice(start);
      const nextLang = text.slice(10).search(/\n==\s*[^=\n]+\(\{\{Sprache\|/);
      if (nextLang >= 0) text = text.slice(0, nextLang + 10);
      return text;
    }
    return /Sprache\|Deutsch/.test(text) ? text : null;
  }

  /** Если статья — только отсылка на другое слово ({{Lemmaverweis|…}}), возвращает это слово. */
  function findLemma(wikitext) {
    const text = germanSection(wikitext);
    if (!text) return "";
    const m = text.match(/\{\{Lemmaverweis\|([^|}]+)/);
    return m ? m[1].trim() : "";
  }

  /** Извлекает часть речи и первые значения из вики-текста немецкой секции. */
  function parseWiktionary(wikitext) {
    const text = germanSection(wikitext);
    if (!text) return { wortart: "", defs: [] };

    const wm = text.match(/\{\{Wortart\|([^|}]+)\|Deutsch/);
    const wortart = wm ? wm[1] : "";

    const idx = text.indexOf("{{Bedeutungen}}");
    if (idx < 0) return { wortart, defs: [] };

    const defs = [];
    const lines = text.slice(idx).split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) {
        if (defs.length) break;
        continue;
      }
      if (!line.startsWith(":[")) {
        if (defs.length) break;
        continue;
      }
      const cleaned = cleanWiki(line);
      if (cleaned) defs.push(cleaned.length > 280 ? cleaned.slice(0, 277) + "…" : cleaned);
      if (defs.length >= 3) break;
    }
    return { wortart, defs };
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

  function pageUrl(word) {
    return "https://de.wiktionary.org/wiki/" + encodeURIComponent(word.charAt(0).toUpperCase() + word.slice(1));
  }

  async function fetchTitle(title) {
    const url =
      API +
      "?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&redirects=1&origin=*&titles=" +
      encodeURIComponent(title);
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    const page = json && json.query && json.query.pages && json.query.pages[0];
    const content = page && page.revisions && page.revisions[0] && page.revisions[0].slots.main.content;
    return content || "";
  }

  /**
   * Возвращает { word, wortart, defs: string[], url, ok }.
   * Сначала пробует слово в нижнем регистре (глаголы/прилагательные), затем с заглавной буквы (существительные).
   */
  async function getExplanation(word) {
    const cache = loadCache();
    if (cache[word]) return cache[word];

    const result = { word, wortart: "", defs: [], url: pageUrl(word), ok: false };
    const titles = [word, word.charAt(0).toUpperCase() + word.slice(1)];
    const tried = [];
    for (const title of titles) {
      try {
        const content = await fetchTitle(title);
        tried.push(title);
        let parsed = parseWiktionary(content);
        // Отсылка на основную форму (Jacht -> Yacht): читаем её статью
        const lemma = !parsed.defs.length && findLemma(content);
        if (lemma && tried.indexOf(lemma) < 0) {
          const lemmaParsed = parseWiktionary(await fetchTitle(lemma));
          if (lemmaParsed.defs.length) parsed = lemmaParsed;
        }
        if (parsed.defs.length) {
          result.wortart = parsed.wortart;
          result.defs = parsed.defs;
          result.ok = true;
          break;
        }
      } catch (e) {
        // Сеть недоступна — вернём результат без пояснения, без кэширования
        return result;
      }
    }
    if (result.ok) {
      cache[word] = result;
      saveCache(cache);
    }
    return result;
  }

  /* ---------- Картинки из Википедии ---------- */

  const IMG_CACHE_KEY = "wordle-deutsch-images-v1";

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

  async function fetchSummary(title) {
    const url = "https://de.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title);
    const res = await fetch(url, { headers: { accept: "application/json" } });
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

    const cap = word.charAt(0).toUpperCase() + word.slice(1);
    for (const title of [cap, word]) {
      let s;
      try {
        s = await fetchSummary(title);
      } catch (e) {
        return null; // сеть недоступна — без кэширования
      }
      if (!s || s.type === "disambiguation" || !s.thumbnail || !s.thumbnail.source) continue;
      const result = {
        title: s.title || cap,
        description: s.description || "",
        thumb: s.thumbnail.source,
        full: (s.originalimage && s.originalimage.source) || s.thumbnail.source,
        page: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || "https://de.wikipedia.org/wiki/" + encodeURIComponent(cap),
      };
      cache[word] = result;
      saveImageCache(cache);
      return result;
    }
    cache[word] = null;
    saveImageCache(cache);
    return null;
  }

  const api = { getExplanation, parseWiktionary, cleanWiki, pageUrl, getWikiImage };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WordExplain = api;
})(typeof self !== "undefined" ? self : this);
