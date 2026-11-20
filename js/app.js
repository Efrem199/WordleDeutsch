/*
 * Wordle & Quordle auf Deutsch — UI, Speicherung und Navigation.
 *
 * Отрисовка: доска перестраивается при каждом нажатии клавиши, поэтому анимации
 * привязаны к событиям, а не к перерисовке:
 *   - reveal (переворот) только у строки, которую только что отправили (freshRows);
 *   - pop (всплытие) только у буквы, которую только что ввели (popPending);
 *   - win (подпрыгивание) только у угаданного слова в момент угадывания (freshWin).
 */
(function () {
  const L = window.WordleLogic;
  const EX = window.WordExplain;
  const STORAGE_KEY = "wordle-deutsch-v1";

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");

  let ANSWERS = [];
  let GUESS_SET = new Set();
  let input = "";            // текущий ввод (не сохраняется)
  let popPending = false;    // была ли только что введена буква
  let freshRows = new Set(); // строки, которые нужно анимировать переворотом
  let freshWin = new Set();  // строки с угаданным словом (подпрыгивание)
  let toastTimer = null;

  /* ---------- Хранение ---------- */

  function loadData() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (d && Array.isArray(d.games) && Array.isArray(d.used)) return d;
    } catch (e) { /* повреждённые данные — начинаем заново */ }
    return { version: 1, games: [], used: [] };
  }
  let data = loadData();

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function playingGame() {
    return data.games.find((g) => g.status === "playing") || null;
  }

  function lastFinishedGame() {
    const done = data.games.filter((x) => x.status === "won" || x.status === "lost");
    return done.length ? done[done.length - 1] : null;
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function startNewGame(mode) {
    const cur = playingGame();
    if (cur) {
      cur.status = "aborted";
      cur.finishedAt = new Date().toISOString();
    }
    const count = L.MODES[mode].boards;
    const { words, reset } = L.pickWords(ANSWERS, count, data.used);
    data.used = (reset ? [] : data.used).concat(words);
    data.games.push({
      id: newId(),
      mode,
      status: "playing",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      maxAttempts: L.MODES[mode].maxAttempts,
      answers: words,
      solvedAt: words.map(() => null), // номер попытки, на которой слово угадано
      guesses: [],                     // { word, results: [результат по доске | null] }
      progress: [],                    // { attempt, solved, at }
    });
    saveData();
    input = "";
    return data.games[data.games.length - 1];
  }

  /* ---------- Декор ---------- */

  /* Плавающие буквы на фоне — лёгкое движение без влияния на игру */
  function buildBackground() {
    const host = document.getElementById("bg-letters");
    if (!host) return;
    const letters = "WORDLEÄÖÜAßÖ";
    const colors = ["#3fa34d", "#ffffff", "#8e94a3"];
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 16; i++) {
      const span = el("span", { text: letters[i % letters.length] });
      span.style.setProperty("--x", rnd(0, 96).toFixed(1) + "%");
      span.style.setProperty("--y", rnd(0, 96).toFixed(1) + "%");
      span.style.setProperty("--s", Math.round(rnd(28, 96)) + "px");
      span.style.setProperty("--o", (rnd(0.04, 0.09)).toFixed(3));
      span.style.setProperty("--d", rnd(14, 28).toFixed(1) + "s");
      span.style.setProperty("--dx", rnd(-60, 60).toFixed(0) + "px");
      span.style.setProperty("--dy", rnd(-60, 60).toFixed(0) + "px");
      span.style.setProperty("--r", rnd(-25, 25).toFixed(0) + "deg");
      span.style.color = colors[i % colors.length];
      host.appendChild(span);
    }
  }

  /* Конфетти при победе: чистый CSS, снимается само через ~3.5 с */
  function celebrate() {
    const box = el("div", { class: "confetti", "aria-hidden": "true" });
    const colors = ["#3fa34d", "#56c266", "#e9c46a", "#ffffff", "#4c8ff0", "#8e94a3"];
    for (let i = 0; i < 90; i++) {
      const piece = el("i");
      piece.style.left = (Math.random() * 100).toFixed(1) + "%";
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty("--t", (2.2 + Math.random() * 1.6).toFixed(2) + "s");
      piece.style.setProperty("--sway", (Math.random() * 120 - 60).toFixed(0) + "px");
      piece.style.setProperty("--spin", (Math.random() * 720 - 360).toFixed(0) + "deg");
      piece.style.animationDelay = (Math.random() * 0.4).toFixed(2) + "s";
      box.appendChild(piece);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4000);
  }

  /* ---------- Логика попытки ---------- */

  function submitGuess(game) {
    if (input.length < L.WORD_LENGTH) return shakeRow("Zu wenig Buchstaben.");
    const word = input;
    if (!GUESS_SET.has(word)) return shakeRow("Nicht in der Wortliste.");
    if (game.guesses.some((g) => g.word === word)) return shakeRow("Dieses Wort hast du schon getippt.");

    const attempt = game.guesses.length + 1;
    const rowIndex = game.guesses.length;
    const results = game.answers.map((ans, i) =>
      game.solvedAt[i] === null ? L.evaluateGuess(word, ans) : null
    );
    game.answers.forEach((ans, i) => {
      if (game.solvedAt[i] === null && word === ans) {
        game.solvedAt[i] = attempt;
        freshWin.add(rowKey(game, rowIndex, i));
      }
    });
    results.forEach((res, b) => { if (res) freshRows.add(rowKey(game, rowIndex, b)); });
    game.guesses.push({ word, results });

    const solved = game.solvedAt.filter((x) => x !== null).length;
    game.progress.push({ attempt, solved, at: new Date().toISOString() });

    if (solved === game.answers.length) {
      finishGame(game, "won");
    } else if (attempt >= game.maxAttempts) {
      finishGame(game, "lost");
    }
    input = "";
    saveData();
    if (game.status === "playing") {
      // Во время игры обновляем только доски и клавиатуру — без перестройки всего экрана
      drawBoards(game);
    } else {
      render(); // игра окончена: показываем результат один раз
      showToast(game.status === "won" ? "Glückwunsch!" : "Leider verloren.");
      if (game.status === "won") celebrate();
    }
  }

  function finishGame(game, status) {
    game.status = status;
    game.finishedAt = new Date().toISOString();
  }

  function rowKey(game, r, b) {
    return game.id + ":" + r + ":" + b;
  }

  /* ---------- Хелперы UI ---------- */

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        if (attrs[k] === undefined || attrs[k] === null) continue;
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
        else n.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach((c) => c && n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1500);
  }

  function shakeRow(msg) {
    showToast(msg);
    const row = document.querySelector(".row.current");
    if (row) {
      row.classList.remove("shake");
      void row.offsetWidth; // перезапуск анимации
      row.classList.add("shake");
    }
  }

  function fmtDate(iso) {
    if (!iso) return "–";
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  }

  function upper(word) {
    return Array.from(word).map(L.displayLetter).join("");
  }

  function statusLabel(s) {
    return { won: "Gewonnen", lost: "Verloren", playing: "Läuft", aborted: "Abgebrochen" }[s] || s;
  }

  function modeLabel(m) {
    return L.MODES[m] ? L.MODES[m].label : m;
  }

  function setView(node) {
    app.innerHTML = "";
    app.appendChild(node);
  }

  /* ---------- Меню ---------- */

  function hero() {
    const letters = [["W", "c"], ["O", "p"], ["R", "a"], ["D", "c"], ["L", "p"], ["E", "c"]];
    const tiles = el("div", { class: "hero-tiles", "aria-hidden": "true" },
      letters.map(([ch, cls], i) => el("div", { class: "hero-tile " + cls, style: `animation-delay:${i * 0.08}s`, text: ch })));
    return el("div", { class: "hero" }, [
      tiles,
      el("h1", { text: "Wordle & Quordle auf Deutsch" }),
      el("p", { text: "Finde das deutsche Wort – allein oder vier auf einmal." }),
    ]);
  }

  /* Мини-превью режима: одна строка плиток (Wordle) или четыре мини-доски (Quordle) */
  function modePreview(mode) {
    if (mode === "wordle") {
      return el("div", { class: "mini mini-row", "aria-hidden": "true" },
        ["c", "p", "a", "a", "c"].map((c) => el("i", { class: "mt " + c })));
    }
    const boards = [["c", "p", "a"], ["a", "c", "a"], ["p", "a", "c"], ["a", "a", "p"]];
    return el("div", { class: "mini mini-quad", "aria-hidden": "true" },
      boards.map((row) => el("div", { class: "mq" }, row.map((c) => el("i", { class: "mt " + c })))));
  }

  function modeCard(mode, title, desc, meta, primary) {
    return el("button", {
      class: "mode-card" + (primary ? " primary" : ""),
      onclick: () => newGame(mode),
    }, [
      mode === "quordle" ? el("span", { class: "mode-badge", text: "4×" }) : null,
      modePreview(mode),
      el("div", { class: "mode-body" }, [
        el("div", { class: "mode-title", text: title }),
        el("div", { class: "mode-desc", text: desc }),
      ]),
      el("div", { class: "mode-meta", text: meta }),
    ]);
  }

  function renderMenu() {
    document.body.classList.remove("is-play");
    const cur = playingGame();
    const wrap = el("div", { class: "view view-menu" });
    wrap.appendChild(hero());

    if (cur) {
      const solved = cur.solvedAt.filter((x) => x !== null).length;
      wrap.appendChild(el("a", { class: "card continue", href: "#play", "aria-label": "Laufendes Spiel fortsetzen" }, [
        el("div", null, [
          el("div", { class: "t", text: "Laufendes Spiel fortsetzen" }),
          el("div", { class: "muted small", text: `${modeLabel(cur.mode)} · Versuch ${cur.guesses.length + 1}/${cur.maxAttempts} · ${solved}/${cur.answers.length} gelöst` }),
        ]),
        el("span", { class: "btn primary", text: "Weiter ›" }),
      ]));
    }

    wrap.appendChild(el("div", { class: "mode-grid" }, [
      modeCard("wordle", "Wordle", "Ein Wort in 6 Versuchen.", "1 Wort · 6 Versuche", !cur),
      modeCard("quordle", "Quordle", "Vier Wörter gleichzeitig in 9 Versuchen.", "4 Wörter · 9 Versuche", false),
    ]));

    wrap.appendChild(el("div", { class: "secondary" }, [
      el("a", { class: "chip", href: "#stats", text: "Verlauf & Statistik" }),
      el("a", { class: "chip", href: "#rules", text: "Spielregeln" }),
    ]));
    wrap.appendChild(el("p", { class: "muted small center", text: `${GUESS_SET.size} gültige Wörter · ${ANSWERS.length} mögliche Lösungen` }));
    setView(wrap);
  }

  function newGame(mode) {
    const cur = playingGame();
    if (cur && !window.confirm("Das laufende Spiel wird als abgebrochen gespeichert. Neues Spiel starten?")) return;
    startNewGame(mode);
    if (location.hash === "#play") render();
    else location.hash = "#play";
  }

  /* ---------- Игра ---------- */

  function renderPlay() {
    const active = playingGame();
    const g = active || lastFinishedGame();
    if (!g) return renderMenu();

    const playing = g.status === "playing";
    const n = g.answers.length;
    document.body.classList.toggle("is-play", playing);

    const view = el("div", { class: "view-play" });
    view.appendChild(el("div", { class: "play-bar" }, [
      el("a", { class: "icon-btn", href: "#menu", text: "‹ Menü" }),
      el("div", { class: "play-info" }, [
        el("strong", { text: modeLabel(g.mode) }),
        el("span", { text: playing
          ? `Versuch ${g.guesses.length + 1} von ${g.maxAttempts}`
          : `${statusLabel(g.status)} · ${g.guesses.length}/${g.maxAttempts} Versuche` }),
      ]),
      playing
        ? el("button", { class: "icon-btn", text: "Neu starten", title: "Laufendes Spiel abbrechen und neu beginnen", onclick: () => newGame(g.mode) })
        : el("button", { class: "icon-btn primary", text: "Neue Runde", onclick: () => newGame(g.mode) }),
    ]));

    const scroll = el("div", { class: "play-scroll" });
    scroll.appendChild(el("div", { id: "boards", class: "boards " + (n > 1 ? "quad" : "single") }));
    if (!playing) scroll.appendChild(buildResult(g));
    view.appendChild(scroll);

    if (playing) {
      view.appendChild(el("div", { class: "keyboard-dock" }, [buildKeyboard()]));
    }
    setView(view);
    drawBoards(g);
  }

  function drawBoards(g) {
    const boards = document.getElementById("boards");
    if (!boards) return;
    const isPlaying = g.status === "playing";
    const nodes = [];

    g.answers.forEach((ans, b) => {
      const solvedAt = g.solvedAt[b];
      const boardEl = el("div", { class: "board" });
      if (g.answers.length > 1) {
        let title = `Wort ${b + 1}`;
        if (solvedAt !== null) title = `✔ ${upper(ans)} · Versuch ${solvedAt}`;
        else if (!isPlaying) title = upper(ans);
        boardEl.appendChild(el("div", { class: "board-title" + (solvedAt !== null ? " solved" : ""), text: title }));
      }

      const rows = el("div", { class: "rows" });
      for (let r = 0; r < g.maxAttempts; r++) {
        const row = el("div", { class: "row" });
        if (r < g.guesses.length) {
          const gu = g.guesses[r];
          const res = gu.results[b];
          if (res) {
            const key = rowKey(g, r, b);
            const fresh = freshRows.has(key);
            const win = freshWin.has(key);
            Array.from(gu.word).forEach((ch, i) => {
              const cls = ["tile", res[i]];
              if (fresh) cls.push("reveal");
              if (win) cls.push("win");
              const t = el("div", { class: cls.join(" "), text: L.displayLetter(ch) });
              if (fresh) {
                // Задержки по колонкам: переворот, смена цвета (и подпрыгивание у угаданного слова)
                const d = (i * 0.15).toFixed(2);
                t.style.animationDelay = win ? `${d}s, ${d}s, ${(i * 0.15 + 0.5).toFixed(2)}s` : `${d}s, ${d}s`;
              }
              row.appendChild(t);
            });
          } else {
            row.classList.add("frozen");
            for (let i = 0; i < L.WORD_LENGTH; i++) row.appendChild(el("div", { class: "tile empty" }));
          }
        } else if (r === g.guesses.length && isPlaying && solvedAt === null) {
          row.classList.add("current");
          const letters = Array.from(input);
          for (let i = 0; i < L.WORD_LENGTH; i++) {
            const ch = letters[i];
            const cls = ["tile", ch ? "filled" : "empty"];
            if (ch && popPending && i === letters.length - 1) cls.push("pop");
            row.appendChild(el("div", { class: cls.join(" "), text: ch ? L.displayLetter(ch) : "" }));
          }
        } else {
          if (solvedAt !== null) row.classList.add("frozen");
          for (let i = 0; i < L.WORD_LENGTH; i++) row.appendChild(el("div", { class: "tile empty" }));
        }
        rows.appendChild(row);
      }
      boardEl.appendChild(rows);
      nodes.push(boardEl);
    });

    boards.replaceChildren(...nodes);
    // Одноразовые флаги: после отрисовки анимации не должны повторяться
    freshRows.clear();
    freshWin.clear();
    popPending = false;
    refreshKeyboard(g);
  }

  const KEYBOARD_ROWS = L.KEYBOARD_ROWS;

  function buildKeyboard() {
    const kb = el("div", { class: "keyboard", id: "keyboard" });
    KEYBOARD_ROWS.forEach((keys, idx) => {
      const row = el("div", { class: "kb-row" });
      if (idx === 2) row.appendChild(el("button", { class: "key wide", text: "Enter", "data-key": "Enter", onclick: () => handleKey("Enter") }));
      keys.forEach((k) => row.appendChild(el("button", { class: "key", text: k === "ß" ? "ẞ" : k, "data-key": k, onclick: () => handleKey(k) })));
      if (idx === 2) row.appendChild(el("button", { class: "key wide", text: "⌫", "data-key": "Backspace", "aria-label": "Löschen", onclick: () => handleKey("Backspace") }));
      kb.appendChild(row);
    });
    return kb;
  }

  function refreshKeyboard(g) {
    const kb = document.getElementById("keyboard");
    if (!kb) return;
    const st = L.keyboardStatuses(g.guesses);
    kb.querySelectorAll(".key[data-key]").forEach((btn) => {
      const k = btn.getAttribute("data-key");
      btn.classList.remove("correct", "present", "absent");
      if (st[k]) btn.classList.add(st[k]);
    });
  }

  function handleKey(key) {
    const g = playingGame();
    if (!g) return;
    if (key === "Enter") return submitGuess(g);
    if (key === "Backspace") {
      input = Array.from(input).slice(0, -1).join("");
    } else if (Array.from(input).length < L.WORD_LENGTH) {
      input += L.normalizeWord(key);
      popPending = true;
    }
    drawBoards(g);
  }

  function buildResult(g) {
    const solved = g.solvedAt.filter((x) => x !== null).length;
    const won = g.status === "won";
    const n = g.answers.length;
    const box = el("section", { class: "card result" });
    box.appendChild(el("div", { class: "result-head" }, [
      el("div", { class: "result-emoji", text: won ? "🎉" : "🙁" }),
      el("div", null, [
        el("h2", { text: won ? "Geschafft!" : "Schade, das war's." }),
        el("p", { class: "muted", text: `${solved} von ${n} ${n > 1 ? "Wörtern" : "Wort"} in ${g.guesses.length} von ${g.maxAttempts} Versuchen erraten.` }),
      ]),
    ]));
    box.appendChild(ringRow(g));
    box.appendChild(el("h2", { text: n > 1 ? "Lösungen & Bedeutung" : "Lösung & Bedeutung" }));
    g.answers.forEach((ans) => box.appendChild(buildExplanation(ans)));
    box.appendChild(el("div", { class: "btn-row" }, [
      el("button", { class: "btn primary", text: "Neue Runde", onclick: () => newGame(g.mode) }),
      el("a", { class: "btn", href: "#stats", text: "Verlauf" }),
      el("a", { class: "btn", href: "#menu", text: "Menü" }),
    ]));
    return box;
  }

  /* Кольцо на каждое слово: заполнено, если угадано, с номером попытки */
  function ringRow(g) {
    const row = el("div", { class: "ring-row" });
    g.answers.forEach((ans, i) => {
      const at = g.solvedAt[i];
      const solved = at !== null;
      const ring = el("div", { class: "ring" }, [el("span", { text: solved ? String(at) : "–" })]);
      ring.style.setProperty("--p", solved ? "100" : "0");
      row.appendChild(el("div", { class: "ring-item" + (solved ? " solved" : "") }, [
        ring,
        el("div", { class: "ring-label", text: solved ? `${upper(ans)} · Versuch ${at}` : `${upper(ans)} · offen` }),
      ]));
    });
    return row;
  }

  function buildExplanation(word) {
    const holder = el("div", { class: "explain" }, [
      el("span", { class: "word", text: upper(word) }),
      el("span", { class: "muted small", text: "  lädt Bedeutung …" }),
    ]);
    Promise.all([
      EX.getExplanation(word),
      EX.getWikiImage(word).catch(() => null),
    ]).then(([r, img]) => {
      holder.innerHTML = "";
      holder.appendChild(el("span", { class: "word", text: upper(word) }));
      if (r.wortart) holder.appendChild(el("span", { class: "pos", text: r.wortart }));
      if (img) holder.appendChild(imageBlock(img));
      if (r.ok) {
        const ol = el("ol");
        r.defs.forEach((d) => ol.appendChild(el("li", { text: d })));
        holder.appendChild(ol);
      } else {
        holder.appendChild(el("p", { class: "muted small", text: "Keine Bedeutung gefunden (offline oder nicht im Wiktionary)." }));
      }
      holder.appendChild(el("a", { href: r.url, target: "_blank", rel: "noopener", text: "Wiktionary ↗" }));
    });
    return holder;
  }

  /* Картинка из Википедии: миниатюра, по клику — увеличенный просмотр с подписью */
  function imageBlock(img) {
    return el("figure", { class: "ex-fig" }, [
      el("button", { class: "ex-img", type: "button", "aria-label": "Bild vergrößern", onclick: () => openLightbox(img) }, [
        el("img", { src: img.thumb, alt: img.title, loading: "lazy" }),
      ]),
      el("figcaption", { class: "ex-cap" }, [
        el("div", { class: "ex-cap-title", text: img.title }),
        img.description ? el("div", { class: "muted small", text: img.description }) : null,
        el("a", { href: img.page, target: "_blank", rel: "noopener", text: "Wikipedia ↗" }),
      ]),
    ]);
  }

  function openLightbox(img) {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    let box = null;
    function close() {
      document.removeEventListener("keydown", onKey);
      if (box) box.remove();
      box = null;
    }
    box = el("div", {
      class: "lightbox",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": img.title,
      onclick: (e) => { if (e.target === box) close(); },
    }, [
      el("div", { class: "lb-inner" }, [
        el("button", { class: "lb-close", type: "button", "aria-label": "Schließen", text: "✕", onclick: close }),
        el("img", { src: img.full, alt: img.title }),
        el("div", { class: "lb-caption" }, [
          el("strong", { text: img.title }),
          img.description ? el("span", { text: " – " + img.description }) : null,
          el("div", { class: "lb-src" }, [el("a", { href: img.page, target: "_blank", rel: "noopener", text: "Quelle: Wikipedia ↗" })]),
        ]),
      ]),
    ]);
    document.body.appendChild(box);
    document.addEventListener("keydown", onKey);
  }

  /* ---------- Статистика и история ---------- */

  function statBox(num, label) {
    return el("div", { class: "stat" }, [el("div", { class: "num", text: String(num) }), el("div", { class: "lbl", text: label })]);
  }

  /* Гистограмма (на какой попытке угадано — как в Wordle) и спарклайн последних игр */
  function statsCharts(finished) {
    const wins = finished.filter((g) => g.mode === "wordle" && g.status === "won");
    const counts = [];
    for (let a = 1; a <= 6; a++) counts.push(wins.filter((g) => g.guesses.length === a).length);
    const max = Math.max(1, ...counts);

    const dist = el("div", { class: "dist" }, counts.map((c, i) => {
      const bar = el("div", { class: "dist-bar" }, [
        el("div", { class: c ? "" : "none", text: String(c) }),
      ]);
      bar.firstChild.style.setProperty("--w", ((c / max) * 100).toFixed(1) + "%");
      return el("div", { class: "dist-row" }, [el("span", { text: String(i + 1) }), bar, el("span", { class: "muted", text: "" })]);
    }));

    const last = finished.slice(-12);
    const spark = el("div", { class: "spark" }, last.map((g) => {
      const total = g.answers.length;
      const solved = g.solvedAt.filter((x) => x !== null).length;
      const h = Math.max(6, Math.round((solved / total) * 100));
      const bar = el("div", { class: "spark-bar " + g.mode });
      bar.style.setProperty("--h", h + "%");
      bar.title = `${modeLabel(g.mode)} · ${solved}/${total} gelöst · ${statusLabel(g.status)}`;
      return el("div", { class: "spark-col" }, [bar, el("span", { class: "spark-lbl", text: modeLabel(g.mode).slice(0, 2) })]);
    }));

    return el("div", { class: "chart-grid", style: "margin-top:14px" }, [
      el("div", { class: "card chart-card" }, [
        el("h2", { text: "Wordle: Siege nach Versuchen" }),
        counts.some((c) => c) ? dist : el("p", { class: "muted", text: "Noch keine Wordle-Siege." }),
      ]),
      el("div", { class: "card chart-card" }, [
        el("h2", { text: "Letzte Spiele" }),
        last.length ? spark : el("p", { class: "muted", text: "Noch keine beendeten Spiele." }),
        el("div", { class: "legend" }, [
          el("span", null, [el("i", { style: "background:#56c266" }), "Wordle"]),
          el("span", null, [el("i", { style: "background:linear-gradient(180deg,#e9c46a,#b08a3a)" }), "Quordle"]),
          el("span", { class: "muted", text: "Höhe = gelöste Wörter" }),
        ]),
      ]),
    ]);
  }

  function renderStats() {
    document.body.classList.remove("is-play");
    const finished = data.games.filter((g) => g.status === "won" || g.status === "lost");
    const won = finished.filter((g) => g.status === "won");
    const wordleDone = finished.filter((g) => g.mode === "wordle");
    const quordleDone = finished.filter((g) => g.mode === "quordle");
    const winRate = finished.length ? Math.round((won.length / finished.length) * 100) : 0;

    let streak = 0, best = 0;
    finished.forEach((g) => {
      if (g.status === "won") { streak++; best = Math.max(best, streak); } else streak = 0;
    });
    const wonWordle = wordleDone.filter((g) => g.status === "won").map((g) => g.guesses.length);
    const avg = wonWordle.length ? (wonWordle.reduce((a, b) => a + b, 0) / wonWordle.length).toFixed(1) : "–";

    const wrap = el("div", { class: "view" });
    wrap.appendChild(el("h1", { text: "Verlauf & Statistik" }));
    wrap.appendChild(el("div", { class: "stat-grid" }, [
      statBox(finished.length, "Spiele beendet"),
      statBox(won.length, "Siege"),
      statBox(winRate + " %", "Siegquote"),
      statBox(best, "Beste Siegesserie"),
      statBox(wordleDone.length, "Wordle beendet"),
      statBox(quordleDone.length, "Quordle beendet"),
      statBox(avg, "Ø Versuche (Wordle-Sieg)"),
    ]));

    wrap.appendChild(statsCharts(finished));

    wrap.appendChild(el("h2", { text: "Alle Spiele" }));
    if (!data.games.length) {
      wrap.appendChild(el("p", { class: "muted", text: "Noch keine Spiele. Starte im Menü eine Runde!" }));
    } else {
      const tbody = el("tbody");
      data.games.slice().reverse().forEach((g) => {
        const solved = g.solvedAt.filter((x) => x !== null).length;
        const detailsList = el("ul", { class: "progress-list" });
        if (!g.progress.length) detailsList.appendChild(el("li", { text: "Keine Versuche." }));
        g.progress.forEach((p) => {
          detailsList.appendChild(el("li", { text: `Versuch ${p.attempt}: ${p.solved} von ${g.answers.length} Wörtern gelöst (${fmtDate(p.at)})` }));
        });
        const explBox = el("div", { class: "word-list" });
        const explBtn = el("button", { class: "btn small", text: "Bedeutungen anzeigen" });
        explBtn.addEventListener("click", () => {
          explBtn.remove();
          g.answers.forEach((w) => explBox.appendChild(buildExplanation(w)));
        });
        const words = el("div", { class: "muted small", text: "Wörter: " + g.answers.map((w, i) =>
          `${upper(w)}${g.solvedAt[i] !== null ? " (Versuch " + g.solvedAt[i] + ")" : " (nicht gelöst)"}`).join(", ") });
        const details = el("details", null, [
          el("summary", { text: "Verlauf" }),
          detailsList,
          el("div", { style: "margin-top:8px" }, [words]),
          el("div", { style: "margin-top:8px" }, [explBtn]),
          explBox,
        ]);
        tbody.appendChild(el("tr", null, [
          el("td", { "data-label": "Datum", text: fmtDate(g.startedAt) }),
          el("td", { "data-label": "Modus", text: modeLabel(g.mode) }),
          el("td", { "data-label": "Ergebnis" }, [el("span", { class: "badge " + g.status, text: statusLabel(g.status) })]),
          el("td", { "data-label": "Gelöst", text: `${solved}/${g.answers.length} · ${g.guesses.length}/${g.maxAttempts}` }),
          el("td", { "data-label": "Details" }, [details]),
        ]));
      });
      wrap.appendChild(el("div", { class: "table-wrap" }, [
        el("table", null, [
          el("thead", null, [el("tr", null, ["Datum", "Modus", "Ergebnis", "Gelöst", "Details"].map((t) => el("th", { text: t })))]),
          tbody,
        ]),
      ]));
    }

    wrap.appendChild(el("div", { class: "btn-row" }, [
      el("a", { class: "btn", href: "#menu", text: "Menü" }),
      el("button", {
        class: "btn danger",
        text: "Alle Daten löschen",
        onclick: () => {
          if (window.confirm("Alle gespeicherten Spiele und Statistiken wirklich löschen?")) {
            data = { version: 1, games: [], used: [] };
            saveData();
            showToast("Daten gelöscht.");
            render();
          }
        },
      }),
    ]));
    setView(wrap);
  }

  /* ---------- Regeln ---------- */

  function renderRules() {
    document.body.classList.remove("is-play");
    const sw = (cls, text) => el("li", null, [el("span", { class: "mode-icons", style: "display:inline-flex;margin-right:8px;vertical-align:middle" }, [el("i", { class: cls, style: "width:16px;height:16px;border-radius:4px;display:block" })]), text]);
    const wrap = el("div", { class: "view card" }, [
      el("h1", { text: "Spielregeln" }),
      el("p", null, [el("strong", { text: "Wordle: " }), "Errate das 5-buchstabige deutsche Wort in höchstens 6 Versuchen."]),
      el("p", null, [el("strong", { text: "Quordle: " }), "Errate gleichzeitig 4 Wörter in höchstens 9 Versuchen. Jeder Tipp gilt für alle noch offenen Wörter."]),
      el("ul", { style: "list-style:none;padding:0;margin:14px 0" }, [
        sw("c", "Grün: der Buchstabe steht richtig an dieser Stelle."),
        sw("p", "Gelb: der Buchstabe kommt im Wort vor, aber an einer anderen Stelle."),
        sw("a", "Grau: der Buchstabe kommt im Wort nicht vor."),
      ]),
      el("p", { class: "muted", text: "Nur echte Wörter aus dem Wörterbuch sind erlaubt. ÄÖÜ sind eigene Buchstaben; ß kommt nicht vor." }),
      el("p", { class: "muted", text: "Am Ende siehst du die Lösung und ihre Bedeutung. Alle Spiele und Versuche werden im Verlauf gespeichert." }),
      el("div", { class: "btn-row" }, [el("a", { class: "btn primary", href: "#menu", text: "Zum Menü" })]),
    ]);
    setView(wrap);
  }

  /* ---------- Маршрутизация ---------- */

  function render() {
    data = loadData();
    const h = (location.hash || "#menu").replace("#", "");
    document.querySelectorAll(".topnav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + h));
    if (h === "play") return renderPlay();
    if (h === "stats") return renderStats();
    if (h === "rules") return renderRules();
    return renderMenu();
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((location.hash || "").replace("#", "") !== "play") return;
    const g = playingGame();
    if (!g) return;
    if (e.key === "Enter") { e.preventDefault(); return handleKey("Enter"); }
    if (e.key === "Backspace") { e.preventDefault(); return handleKey("Backspace"); }
    if (/^[a-zA-ZäöüÄÖÜß]$/.test(e.key)) { e.preventDefault(); handleKey(e.key); }
  });

  window.addEventListener("hashchange", render);

  /* ---------- Старт ---------- */

  async function init() {
    try {
      const [answers, guesses] = await Promise.all([
        fetch("data/answers.json").then((r) => r.json()),
        fetch("data/guesses.json").then((r) => r.json()),
      ]);
      ANSWERS = answers;
      GUESS_SET = new Set(guesses);
    } catch (e) {
      app.innerHTML = "";
      app.appendChild(el("p", { class: "card", text: "Die Wortliste konnte nicht geladen werden. Bitte lade die Seite neu." }));
      return;
    }
    render();
  }

  init();
  buildBackground();
})();
