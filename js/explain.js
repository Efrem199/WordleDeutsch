/*
 * Пояснения существительных из немецкого Wiktionary (de.wiktionary.org) через MediaWiki API (CORS, origin=*).
 * Берётся только немецкая секция «Substantiv» со словом с заглавной буквы: строчное «wurst» — это другое слово
 * (прилагательное «egal»), поэтому оно не запрашивается. Результаты кэшируются в localStorage.
 * Лицензия текстов: CC BY-SA 4.0.
 */
(function (root) {
  const CACHE_KEY = "wordle-deutsch-definitions-v2";
  const API = "https://de.wiktionary.org/w/api.php";
  const MAX_DEFS = 3;
  const MAX_LEN = 280;

  /** Расшифровка помет Wiktionary (Kontext-Angaben), частые в «Bedeutungen». */
  const LABELS = {
    "ugs.": "umgangssprachlich", "landsch.": "landschaftlich", "sonst": "sonst", "va.": "veraltet",
    "vatd.": "veraltend", "abw.": "abwertend", "Bedva.": "veraltete Bedeutung", "derb": "derb",
    "Jägersprache": "Jägersprache", "Zoologie": "Zoologie", "Gastronomie": "Gastronomie",
  };

  /** Очистка строки вики-текста до обычного текста. */
  function cleanWiki(line) {
    let t = line;
    t = t.replace(/<!--[\s\S]*?-->/g, "");
    t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
    t = t.replace(/<ref[^>]*\/>/g, "");
    // {{K|Gastronomie}}, {{K|ugs.|übertragen}} -> (Gastronomie) / (umgangssprachlich, übertragen)
    t = t.replace(/\{\{K\|([^{}]*)\}\}/g, (m, body) => {
      const params = body.split("|").map((x) => x.trim()).filter((x) => x && x.indexOf("=") < 0);
      const labels = params.map((x) => LABELS[x] || x);
      return labels.length ? "(" + labels.join(", ") + ") " : "";
    });
    // Ссылки на другие значения внутри текста: «unter [1] beschriebenen» -> «unter Bedeutung 1 beschriebenen»
    t = t.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, nums) => {
      const list = nums.replace(/\s+/g, "");
      return (list.indexOf(",") >= 0 ? "Bedeutungen " : "Bedeutung ") + list.replace(/,/g, ", ");
    });
    // Прочие шаблоны (Ü, Lit, Hilfe …) убираем; вложенные — несколькими проходами
    for (let i = 0; i < 10 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, "");
    // Ссылки: [[a|b]] -> b, [[a]] -> a
    for (let i = 0; i < 5 && /\[\[[^\[\]]*\]\]/.test(t); i++) t = t.replace(/\[\[(?:[^\[\]|]*\|)?([^\[\]]*)\]\]/g, "$1");
    t = t.replace(/'{2,}/g, "");                       // курсив и полужирный
    t = t.replace(/\[\d+(?:[,–-]\s*\d+)*\]/g, "");   // сноски [1], [1, 2]
    t = t.replace(/\s+/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(").trim();
    return t;
  }

  /** Немецкая секция вики-текста или null, если её нет. */
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

  /** Подсекция «Substantiv» внутри немецкой секции или null. Другие части речи не используются. */
  function nounSection(german) {
    const head = /^=+\s*\{\{Wortart\|Substantiv\|Deutsch\}\}.*$/m.exec(german);
    if (!head) return null;
    const after = head.index + head[0].length;
    const next = /^=+\s*\{\{Wortart\|/m.exec(german.slice(after));
    return german.slice(head.index, next ? after + next.index : german.length);
  }

  /** Значения из блока {{Bedeutungen}}: только строки вида «:[1] …», вложенные «::[1.1]» пропускаются. */
  function parseDefs(section) {
    const lines = section.split("\n");
    const start = lines.findIndex((l) => l.trim() === "{{Bedeutungen}}");
    if (start < 0) return [];
    const defs = [];
    for (const line of lines.slice(start + 1)) {
      if (/^\{\{|^==/.test(line)) break; // начался следующий раздел
      const m = /^:\[(\d+)\]\s*(.*)$/.exec(line);
      if (!m) continue;
      const cleaned = cleanWiki(m[2]);
      if (cleaned) defs.push(cleaned.length > MAX_LEN ? cleaned.slice(0, MAX_LEN - 1) + "…" : cleaned);
      if (defs.length >= MAX_DEFS) break;
    }
    return defs;
  }

  /** Часть речи и значения существительного из вики-текста. */
  function parseWiktionary(wikitext) {
    const german = germanSection(wikitext);
    if (!german) return { wortart: "", defs: [] };
    const noun = nounSection(german);
    if (!noun) return { wortart: "", defs: [] };
    return { wortart: "Substantiv", defs: parseDefs(noun) };
  }

  /** Если статья — только отсылка ({{Lemmaverweis|…}}), возвращает основную форму. */
  function findLemma(wikitext) {
    const german = germanSection(wikitext);
    if (!german) return "";
    const m = german.match(/\{\{Lemmaverweis\|([^|}]+)/);
    return m ? m[1].trim() : "";
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
   * Возвращает { word, wortart, defs, url, ok }.
   * Слово в игре — существительное, поэтому ищем его с заглавной буквы. Если статья — отсылка
   * (Jacht → Yacht), берём значения основной формы; слово в подписи остаётся прежним.
   */
  async function getExplanation(word) {
    const cache = loadCache();
    if (cache[word]) return cache[word];

    const result = { word, wortart: "", defs: [], url: pageUrl(word), ok: false };
    const title = word.charAt(0).toUpperCase() + word.slice(1);
    try {
      const content = await fetchTitle(title);
      let parsed = parseWiktionary(content);
      const lemma = !parsed.defs.length && findLemma(content);
      if (lemma && lemma !== title) {
        const lemmaParsed = parseWiktionary(await fetchTitle(lemma));
        if (lemmaParsed.defs.length) parsed = lemmaParsed;
      }
      if (parsed.defs.length) {
        result.wortart = parsed.wortart;
        result.defs = parsed.defs;
        result.ok = true;
        cache[word] = result;
        saveCache(cache);
      }
    } catch (e) {
      // Сеть недоступна — пояснения нет, в кэш не пишем
    }
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
        title: cap, // подпись — то слово, что выпало в игре, а не название статьи после редиректа
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

  const api = { getExplanation, parseWiktionary, findLemma, cleanWiki, pageUrl, getWikiImage };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WordExplain = api;
})(typeof self !== "undefined" ? self : this);
