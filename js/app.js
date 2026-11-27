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
  const storageNotice = document.getElementById("storage-notice");

  let ANSWERS = [];
  let GUESS_SET = new Set();
  let DAILY_WORDS = [];
  let dictionaryState = "loading";
  let dailyState = "loading";
  let input = "";            // текущий ввод (не сохраняется)
  let popPending = false;    // была ли только что введена буква
  let freshRows = new Set(); // строки, которые нужно анимировать переворотом
  let freshWin = new Set();  // строки с угаданным словом (подпрыгивание)
  let toastTimer = null;
  let submitting = false;
  let selectedBoard = 0;
  let showOverview = false;
  const landscapePlay = window.matchMedia("(orientation: landscape) and (max-height: 500px) and (max-width: 1100px)");
  const compactBoards = window.matchMedia("(max-width: 700px), " + landscapePlay.media);
  let visibleGameId = null;

  /* ---------- Хранение ---------- */

  function emptyData() {
    return { version: 1, games: [], used: [], savedWords: [] };
  }

  function loadData() {
    let stored;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
    try {
      const d = JSON.parse(stored);
      if (d && Array.isArray(d.games) && Array.isArray(d.used)) {
        // Versions before the loading guard could save a game with null answers.
        d.games = d.games.filter((g) => Object.hasOwn(L.MODES, g?.mode)
          && Array.isArray(g.answers) && g.answers.length === L.MODES[g.mode].boards
          && g.answers.every(L.isWellFormed)
          && Array.isArray(g.guesses) && Array.isArray(g.progress)
          && Array.isArray(g.solvedAt) && g.solvedAt.length === g.answers.length);
        d.used = d.used.filter(L.isWellFormed);
        d.savedWords = Array.isArray(d.savedWords) ? [...new Set(d.savedWords.filter(L.isWellFormed))] : [];
        return d;
      }
    } catch { /* повреждённые данные — начинаем заново */ }
    return emptyData();
  }
  const storedData = loadData();
  let data = storedData || emptyData();
  let sessionOnly = !storedData;
  storageNotice.hidden = !sessionOnly;

  function saveData() {
    if (sessionOnly) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      sessionOnly = true;
      storageNotice.hidden = false;
    }
  }

  function updateData(change) {
    const update = () => {
      if (!sessionOnly) data = loadData() || data;
      change();
    };
    // Reload and write under one origin-wide lock when the browser supports it.
    if (navigator.locks) return navigator.locks.request(STORAGE_KEY, update);
    update();
  }

  function randomGame() {
    return data.games.find((g) => !g.dailyDate && g.status === "playing") || null;
  }

  function todayGame(mode, date) {
    return data.games.find((g) => g.dailyDate === date && g.mode === mode);
  }

  function playUrl(game) {
    return "#play/" + game.id;
  }

  function routedGame() {
    const hash = location.hash;
    if (hash.startsWith("#play/")) return data.games.find((g) => playUrl(g) === hash) || null;
    if (hash !== "#play") return null;
    return randomGame() || data.games.findLast((g) => g.status === "playing")
      || data.games.findLast((g) => g.status === "won" || g.status === "lost") || null;
  }

  function playingGame() {
    const game = routedGame();
    return game?.status === "playing" ? game : null;
  }

  function goToGame(game) {
    if (location.hash === playUrl(game)) render();
    else location.hash = playUrl(game);
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function addGame(mode, words, dailyDate) {
    const game = {
      id: newId(),
      mode,
      ...(dailyDate ? { dailyDate } : {}),
      status: "playing",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      maxAttempts: L.MODES[mode].maxAttempts,
      answers: words,
      solvedAt: words.map(() => null), // номер попытки, на которой слово угадано
      guesses: [],                     // { word, results: [результат по доске | null] }
      progress: [],                    // { attempt, solved, at }
    };
    data.games.push(game);
    saveData();
    return game;
  }

  /* ---------- Логика попытки ---------- */

  function submitGuess(game) {
    if (dictionaryState !== "ready" || submitting) return;
    const word = input;
    if (word.length < L.WORD_LENGTH) return shakeRow("Zu wenig Buchstaben.");
    submitting = true;
    (async () => {
      try {
        await updateData(() => {
          const current = playingGame();
          if (current?.id !== game.id) {
            input = "";
            render();
            return showToast("Das laufende Spiel hat sich geändert.");
          }
          applyGuess(current, word);
        });
      } finally {
        submitting = false;
      }
    })();
  }

  function applyGuess(game, word) {
    // Existing games can still be won after a word is removed from the dictionary.
    if (!GUESS_SET.has(word) && !game.answers.includes(word)) return shakeRow("Nicht in der Wortliste.");
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
      if (game.solvedAt[selectedBoard] !== null) selectedBoard = game.solvedAt.indexOf(null);
      drawBoards(game);
      scrollToBoard(game);
    } else {
      render(); // игра окончена: показываем результат один раз
      showToast(game.status === "won" ? "Glückwunsch!" : "Leider verloren.");
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
    const row = document.querySelector(".board.is-selected .row.current");
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

  function modeCard(mode, daily, date) {
    const info = L.MODES[mode];
    const game = daily ? todayGame(mode, date) : null;
    const state = game?.status === "playing" ? "Fortsetzen" : game ? statusLabel(game.status)
      : `${info.boards} ${info.boards === 1 ? "Wort" : "Wörter"} · ${info.maxAttempts} Versuche`;
    return el("button", {
      class: daily ? "daily-card" : "mode-card",
      type: "button",
      disabled: daily && !game && dailyState !== "ready" ? true : null,
      onclick: () => daily ? openDaily(mode) : newGame(mode),
    }, [
      daily ? null : modePreview(mode),
      el("span", { class: "mode-body" }, [
        el("strong", { text: info.label }),
        el("span", { class: "muted", text: state }),
      ]),
      el("span", { class: "mode-arrow", "aria-hidden": "true", text: "›" }),
    ]);
  }

  let menuDay = "";
  const dailyDateLabel = new Intl.DateTimeFormat("de-DE", {
    timeZone: L.DAILY_TIME_ZONE, day: "numeric", month: "long",
  });
  const localResetLabel = new Intl.DateTimeFormat("de-DE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  function dailyPanel(date, now) {
    const reset = L.nextDailyReset(now);
    return el("section", { class: "daily-panel", "aria-labelledby": "today-title" }, [
      el("div", { class: "section-head" }, [
        el("h2", { id: "today-title", text: "Tagesrätsel" }),
        el("time", { datetime: date, text: dailyDateLabel.format(new Date(date + "T12:00:00Z")) + " · Berlin" }),
      ]),
      el("div", { class: "mode-grid" }, [modeCard("wordle", true, date), modeCard("quordle", true, date)]),
      dailyState === "error" ? el("p", { class: "muted", text: "Das Tagesrätsel konnte nicht geladen werden." }) : null,
      el("p", { class: "daily-reset muted" }, [
        "Nächster Wechsel · ",
        el("time", { datetime: reset.toISOString(), text: localResetLabel.format(reset) }),
        " (Ortszeit)",
      ]),
    ]);
  }

  function menuProgress() {
    const finished = data.games.filter((game) => game.status === "won" || game.status === "lost");
    const last = finished.reduce((latest, game) =>
      !latest || (game.finishedAt || game.startedAt) >= (latest.finishedAt || latest.startedAt) ? game : latest, null);
    const saved = data.savedWords.length;
    const link = (title, description, href) => el("a", { class: "progress-link", href }, [
      el("span", { class: "progress-link-copy" }, [
        el("strong", { text: title }), el("span", { class: "muted", text: description }),
      ]),
      el("span", { "aria-hidden": "true", text: "›" }),
    ]);
    return el("aside", { class: "menu-progress", "aria-labelledby": "progress-title" }, [
      el("h2", { id: "progress-title", text: "Dein Spielstand" }),
      last ? link("Letzte Partie", `${modeLabel(last.mode)} · ${statusLabel(last.status)} · ${last.guesses.length}/${last.maxAttempts}`, playUrl(last))
        : el("p", { class: "menu-progress-empty muted", text: "Deine letzte Partie erscheint hier, sobald du eine Runde beendet hast." }),
      link("Wortschatz", `${saved} ${saved === 1 ? "gemerktes Wort" : "gemerkte Wörter"}`, "#vocab"),
      link("Verlauf", `${finished.length} ${finished.length === 1 ? "beendete Partie" : "beendete Partien"}`, "#stats"),
    ]);
  }

  function renderMenu() {
    document.body.classList.remove("is-play");
    const entering = !app.querySelector(".view-menu");
    const cur = randomGame();
    const now = new Date();
    const date = menuDay = L.dailyDate(now);
    const wrap = el("div", { class: "view view-menu" });
    wrap.append(
      el("section", { class: "hero" }, [
        el("div", { class: entering ? "hero-tiles entering" : "hero-tiles", "aria-hidden": "true" },
          [..."WORDLE"].map((letter, i) => el("span", {
            class: ["correct", "present", "absent", "correct", "absent", "correct"][i],
            style: `--tile-order: ${i}`, text: letter,
          }))),
        el("h1", { text: "Wordle & Quordle auf Deutsch" }),
      ]),
      el("div", { class: "menu-layout" }, [
        el("div", { class: "menu-modes" }, [
          el("section", { class: "free-panel", "aria-labelledby": "free-title" }, [
            el("div", { class: "section-head" }, [el("h2", { id: "free-title", text: "Freies Spiel" })]),
            cur ? el("a", { class: "continue", href: playUrl(cur), "aria-label": "Laufendes Spiel fortsetzen" }, [
              el("strong", { text: `${modeLabel(cur.mode)} fortsetzen` }),
              el("span", { class: "muted", text: `Versuch ${cur.guesses.length + 1} von ${cur.maxAttempts} ›` }),
            ]) : null,
            el("div", { class: "mode-grid" }, [modeCard("wordle", false), modeCard("quordle", false)]),
          ]),
          dailyPanel(date, now),
        ]),
        menuProgress(),
      ]),
    );
    setView(wrap);
  }

  function newGame(mode) {
    if (dictionaryState !== "ready") return;
    const cur = randomGame();
    if (cur && !window.confirm("Das laufende Spiel wird als abgebrochen gespeichert. Neues Spiel starten?")) return;
    updateData(() => {
      const current = randomGame();
      if (current?.id !== cur?.id) {
        input = "";
        render();
        return showToast("Das laufende Spiel hat sich geändert.");
      }
      const { words, reset } = L.pickWords(ANSWERS, L.MODES[mode].boards, data.used);
      if (current) finishGame(current, "aborted");
      data.used = (reset ? [] : data.used).concat(words);
      goToGame(addGame(mode, words));
    });
  }

  function openDaily(mode) {
    if (dictionaryState !== "ready") return;
    updateData(() => {
      const date = L.dailyDate();
      const existing = todayGame(mode, date);
      if (existing) return goToGame(existing);
      if (dailyState === "ready") goToGame(addGame(mode, L.dailyWords(DAILY_WORDS, mode, date), date));
    });
  }

  /* ---------- Игра ---------- */

  function renderPlay() {
    const g = routedGame();
    if (!g) return renderMenu();
    if (g.id !== visibleGameId) {
      visibleGameId = g.id;
      input = "";
      selectedBoard = Math.max(0, g.solvedAt.indexOf(null));
      showOverview = false;
    }

    const playing = g.status === "playing";
    const n = g.answers.length;
    document.body.classList.toggle("is-play", playing);

    const view = el("div", { class: playing ? "view-play" + (n > 1 ? " is-quordle" : "") : "view-play view-result" });
    view.appendChild(el("div", { class: "play-bar" }, [
      el("a", { class: "icon-btn", href: "#menu", text: "‹ Menü" }),
      el("div", { class: "play-info" }, [
        el("strong", { text: g.dailyDate ? `${modeLabel(g.mode)} · Tagesrätsel` : modeLabel(g.mode) }),
        playing ? el("span", { id: "play-attempt", text: `Versuch ${g.guesses.length + 1} von ${g.maxAttempts}` }) : null,
      ]),
      g.dailyDate ? el("time", { datetime: g.dailyDate, class: "puzzle-date", text: g.dailyDate.split("-").slice(1).reverse().join(".") + "." })
        : playing ? el("button", { class: "icon-btn", text: "Neu starten", onclick: () => newGame(g.mode) }) : el("span"),
    ]));

    if (!playing) {
      view.appendChild(buildResult(g));
      setView(view);
      return;
    }

    const controls = el("div", { class: "play-controls" });
    if (n > 1) {
      const select = (index) => {
        selectedBoard = index;
        showOverview = false;
        const latest = routedGame();
        if (latest) {
          drawBoards(latest);
          scrollToBoard(latest);
        }
      };
      controls.appendChild(el("div", { class: "quordle-nav" }, [
        boardPicker(g, selectedBoard, select, "play-pick"),
        el("button", { type: "button", class: "overview-toggle", "aria-pressed": showOverview,
          "aria-label": "Alle vier Wörter anzeigen", text: "Alle", onclick: () => {
            showOverview = !showOverview;
            const latest = routedGame();
            if (latest) {
              drawBoards(latest);
              if (showOverview) document.querySelector(".play-scroll").scrollTop = 0;
              else scrollToBoard(latest);
            }
          } }),
      ]));
    }
    const scroll = el("div", { class: "play-scroll" });
    scroll.appendChild(el("div", { id: "boards", class: "boards " + (n > 1 ? "quad" : "single") }));
    view.appendChild(scroll);

    controls.appendChild(el("div", { class: "keyboard-dock" }, [buildKeyboard(n)]));
    view.appendChild(controls);
    setView(view);
    drawBoards(g);
    scrollToBoard(g);
  }

  function boardPicker(game, selected, onSelect, className) {
    return el("div", { class: "board-picker " + className, role: "group", "aria-label": "Wort auswählen" },
      game.answers.map((_, index) => el("button", {
        type: "button", class: "board-switch", "data-board-pick": index, "aria-pressed": selected === index,
        onclick: () => onSelect(index),
      }, [el("span", { text: `Wort ${index + 1}` }), el("span", {
        class: "board-switch-state", text: boardState(game, index),
      }), className === "play-pick" ? el("span", { class: "board-hint", "aria-hidden": "true" },
        Array.from({ length: L.WORD_LENGTH }, () => el("i"))) : null])));
  }

  function boardState(game, index) {
    if (game.solvedAt[index] !== null) return "Gelöst";
    return game.status === "playing" ? "Offen" : "Ungelöst";
  }

  function updateBoardPicker(picker, game, selected) {
    picker?.querySelectorAll("[data-board-pick]").forEach((button, index) => {
      const solved = game.solvedAt[index] !== null;
      button.setAttribute("aria-pressed", selected === index);
      button.classList.toggle("is-solved", solved);
      button.querySelector(".board-switch-state").textContent = boardState(game, index);
      const hint = button.querySelector(".board-hint");
      if (hint) {
        const last = game.guesses.findLast((guess) => guess.results[index])?.results[index];
        [...hint.children].forEach((tile, column) => { tile.className = last?.[column] || ""; });
      }
    });
  }

  function scrollToBoard(game) {
    if (game.mode === "quordle" && (!compactBoards.matches || showOverview)) return;
    requestAnimationFrame(() => {
      if (routedGame()?.id !== game.id) return;
      const board = document.querySelector(`#boards [data-board="${selectedBoard}"]`);
      (board?.querySelector(".row.current") || board)?.scrollIntoView({ block: "nearest" });
    });
  }

  function drawBoards(g) {
    const boards = document.getElementById("boards");
    if (!boards) return;
    const overview = compactBoards.matches && showOverview;
    boards.classList.toggle("show-overview", overview);
    document.querySelector(".overview-toggle")?.setAttribute("aria-pressed", overview);
    const isPlaying = g.status === "playing";
    if (isPlaying) document.getElementById("play-attempt").textContent = `Versuch ${g.guesses.length + 1} von ${g.maxAttempts}`;
    const nodes = [];

    g.answers.forEach((ans, b) => {
      const solvedAt = g.solvedAt[b];
      const boardEl = el("div", { class: "board" + (selectedBoard === b ? " is-selected" : ""),
        "data-board": b, role: "group", "aria-label": `Wort ${b + 1}` });
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
    updateBoardPicker(document.querySelector(".play-pick"), g, overview ? -1 : selectedBoard);
    // Одноразовые флаги: после отрисовки анимации не должны повторяться
    freshRows.clear();
    freshWin.clear();
    popPending = false;
    refreshKeyboard(g);
  }

  const KEYBOARD_ROWS = L.KEYBOARD_ROWS;

  /* Значки клавиш Enter и Backspace — SVG, чтобы масштабировались вместе с клавишей */
  const ICON_ENTER =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M20 4v7a4 4 0 0 1-4 4H4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_BACK =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>' +
    '<path d="M12 9l5 6M17 9l-5 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  function keyIcon(key, label, svg, onClick) {
    const b = el("button", { class: "key wide key-icon", "data-key": key, "aria-label": label, onclick: onClick });
    b.innerHTML = svg;
    return b;
  }

  const TILE_LABELS = { correct: "richtig", present: "andere Stelle", absent: "fehlt" };

  function buildKeyboard(boardCount) {
    const kb = el("div", { class: "keyboard", id: "keyboard" });
    KEYBOARD_ROWS.forEach((keys, idx) => {
      const row = el("div", { class: "kb-row" });
      if (idx === 2) row.appendChild(keyIcon("Enter", "Eingeben", ICON_ENTER, () => handleKey("Enter")));
      keys.forEach((k) => {
        const sectors = boardCount > 1 ? el("span", { class: "key-sectors", "aria-hidden": "true" },
          Array.from({ length: boardCount }, () => el("i"))) : null;
        row.appendChild(el("button", { class: "key letter-key", type: "button", "data-key": k, onclick: () => handleKey(k) }, [
          sectors, el("span", { class: "key-letter", text: L.displayLetter(k) }),
        ]));
      });
      if (idx === 2) row.appendChild(keyIcon("Backspace", "Löschen", ICON_BACK, () => handleKey("Backspace")));
      kb.appendChild(row);
    });
    return kb;
  }

  function refreshKeyboard(g) {
    const kb = document.getElementById("keyboard");
    if (!kb) return;
    const states = g.answers.map((_, board) => L.keyboardStatuses(g.guesses, board));
    kb.querySelectorAll(".letter-key").forEach((btn) => {
      const k = btn.getAttribute("data-key");
      const label = L.displayLetter(k);
      if (states.length === 1) {
        btn.classList.remove("correct", "present", "absent");
        const status = states[0][k];
        if (status) btn.classList.add(status);
        btn.setAttribute("aria-label", status ? `${label}, ${TILE_LABELS[status]}` : label);
      } else {
        const statuses = [];
        btn.querySelectorAll(".key-sectors i").forEach((sector, i) => {
          const status = states[i][k];
          sector.className = status || "";
          statuses.push(`Wort ${i + 1}: ${status ? TILE_LABELS[status] : "offen"}`);
        });
        btn.setAttribute("aria-label", [label, ...statuses].join(", "));
      }
    });
  }

  function handleKey(key) {
    if (dictionaryState !== "ready" || submitting) return;
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
    const box = el("section", { class: "result" });
    const summary = el("div", { class: "result-summary" }, [
      el("h1", { text: won ? "Geschafft!" : g.status === "aborted" ? "Runde abgebrochen" : "Schade, das war’s." }),
      el("p", { class: "muted", text: (n > 1 ? `${solved} von ${n} Wörtern · ` : "") +
        `${g.guesses.length} von ${g.maxAttempts} Versuchen` }),
    ]);
    const share = g.dailyDate ? el("textarea", { class: "share-result", readonly: true, hidden: true,
      rows: 6, "aria-label": "Ergebnis zum Kopieren" }) : null;
    summary.appendChild(el("div", { class: "btn-row" }, [
      g.dailyDate ? el("button", { class: "btn primary", text: "Ergebnis kopieren", onclick: () => copyDailyResult(g, share) }) : null,
      el("button", { class: g.dailyDate ? "btn" : "btn primary", text: g.dailyDate ? "Freies Spiel" : "Neue Runde", onclick: () => newGame(g.mode) }),
      el("a", { class: "btn", href: "#stats", text: "Verlauf" }),
    ]));
    if (share) summary.appendChild(share);
    box.appendChild(summary);
    box.appendChild(el("section", { class: "result-words" }, [
      el("h2", { text: n > 1 ? "Lösungen" : "Lösung" }),
      el("div", { class: "word-grid" }, g.answers.map((ans, index) =>
        buildExplanation(ans, g.solvedAt[index] ? `Versuch ${g.solvedAt[index]}` : "Nicht gelöst"))),
    ]));
    const review = el("details", { class: "result-review" }, [el("summary", { text: "Spiel analysieren" })]);
    review.addEventListener("toggle", () => {
      if (review.open && review.childElementCount === 1) review.appendChild(buildReplay(g));
    });
    box.appendChild(review);
    return box;
  }

  async function copyDailyResult(game, fallback) {
    const url = new URL(location.href);
    url.hash = "";
    url.search = "";
    const text = L.dailyShareText(game) + "\n\n" + url.href;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Ergebnis kopiert.");
    } catch {
      fallback.value = text;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
    }
  }

  function updateSaveButton(button) {
    const saved = data.savedWords.includes(button.dataset.saveWord);
    button.textContent = saved ? "Gemerkt" : "Merken";
    button.setAttribute("aria-pressed", saved);
  }

  function toggleSavedWord(word) {
    updateData(() => {
      const saved = data.savedWords.includes(word);
      data.savedWords = saved ? data.savedWords.filter((item) => item !== word) : [word, ...data.savedWords];
      saveData();
      if (location.hash === "#vocab") {
        renderVocabulary();
        document.querySelector(".vocab-entry summary, .view-vocabulary h1")?.focus();
      } else {
        document.querySelectorAll("[data-save-word]").forEach(updateSaveButton);
      }
      showToast(saved ? "Aus dem Wortschatz entfernt." : "Im Wortschatz gespeichert.");
    });
  }

  let playingAudio;
  function playPronunciation(url) {
    playingAudio?.pause();
    playingAudio = new Audio(url);
    playingAudio.play().catch(() => showToast("Die Aussprache konnte nicht abgespielt werden."));
  }

  function buildExplanation(word, meta = "") {
    const title = el("h3", { class: "word", text: L.displayLetter(word[0]) + word.slice(1) });
    const plural = el("p", { class: "word-plural", hidden: true });
    const actions = el("div", { class: "word-actions" });
    const mark = el("button", { class: "btn small", type: "button", "data-save-word": word, onclick: () => toggleSavedWord(word) });
    updateSaveButton(mark);
    actions.appendChild(mark);
    const content = el("div", { class: "word-definition" }, [el("span", { class: "muted small", text: "lädt Bedeutung …" })]);
    const holder = el("article", { class: "explain" }, [
      el("header", { class: "word-head" }, [
        el("div", null, [meta ? el("p", { class: "word-meta", text: meta }) : null, title, plural]),
        actions,
      ]),
      content,
    ]);
    const loadWikipediaImage = () => {
      if (!holder.isConnected) return;
      EX.getWikiImage(word).catch(() => null).then((image) => {
        if (image && holder.isConnected) content.before(imageBlock(image));
      });
    };
    EX.getExplanation(word).then((r) => {
      if (r.grammar?.singular) title.textContent = r.grammar.singular;
      if (r.grammar?.plurals.length) {
        plural.textContent = "Plural: " + r.grammar.plurals.join(", ");
        plural.hidden = false;
      }
      if (r.audio) actions.prepend(el("button", { class: "btn small", type: "button", text: "Anhören",
        "aria-label": `${title.textContent} anhören`, onclick: () => playPronunciation(r.audio.url) }));
      let definition;
      if (r.ok) {
        definition = el("ol", null, r.defs.map((d) => el("li", { text: d })));
      } else {
        definition = el("p", { class: "muted small", text: "Keine Bedeutung gefunden (offline oder nicht im Wiktionary)." });
      }
      content.replaceChildren(definition, el("div", { class: "word-sources" }, [
        el("a", { href: r.url, target: "_blank", rel: "noopener", text: "Wiktionary ↗" }),
        r.audio ? el("a", { href: r.audio.page, target: "_blank", rel: "noopener", text: "Audioquelle ↗" }) : null,
      ]));
      if (r.image && holder.isConnected) content.before(imageBlock(r.image, loadWikipediaImage));
      else loadWikipediaImage();
    });
    return holder;
  }

  function vocabularyEntry(word, className, open = false) {
    const entry = el("details", { class: className, open: open || null }, [
      el("summary", { text: L.displayLetter(word[0]) + word.slice(1) }),
    ]);
    entry.addEventListener("toggle", () => {
      if (entry.open && entry.childElementCount === 1) entry.appendChild(buildExplanation(word));
    });
    if (open) entry.appendChild(buildExplanation(word));
    return entry;
  }

  function renderVocabulary() {
    document.body.classList.remove("is-play");
    const saved = data.savedWords;
    const view = el("div", { class: "view view-vocabulary" }, [
      el("header", { class: "page-heading" }, [el("h1", { tabindex: -1, text: "Wortschatz" }),
        el("p", { class: "muted", text: `${saved.length} ${saved.length === 1 ? "gemerktes Wort" : "gemerkte Wörter"}` })]),
    ]);
    const hidden = new Set(saved);
    data.games.filter((game) => game.status === "playing")
      .forEach((game) => game.answers.forEach((word) => hidden.add(word)));
    const examples = ["katze", "tisch", "blume", "wolke", "fisch", "vogel", "stern", "boden", "apfel", "sturm"]
      .filter((word) => !hidden.has(word)).slice(0, 3);
    const firstOpen = !saved.length && window.matchMedia("(min-width: 861px)").matches;
    view.appendChild(el("div", { class: "section-columns vocabulary-layout" }, [
      el("section", { class: "card saved-panel", "aria-labelledby": "saved-heading" }, [
        el("h2", { id: "saved-heading", text: "Gemerkt" }),
        saved.length
          ? el("div", { class: "vocabulary-entries" }, saved.map((word) => vocabularyEntry(word, "vocab-entry")))
          : el("div", { class: "saved-empty" }, [
            el("p", { class: "muted", text: "Öffne eine Wortkarte und tippe auf „Merken“, um sie hier zu speichern." }),
            el("a", { href: "#menu", class: "btn", text: "Spielen" }),
          ]),
      ]),
      examples.length ? el("section", { class: "card discover-panel", "aria-labelledby": "discover-heading" }, [
        el("h2", { id: "discover-heading", text: "Wörter entdecken" }),
        el("div", { class: "vocabulary-entries" }, examples.map((word, i) => vocabularyEntry(word, "discovery-entry", firstOpen && i === 0))),
      ]) : null,
    ]));
    setView(view);
  }

  /* Миниатюра и увеличенная версия используют запасные URL Wikimedia. */
  function wikimediaImage(img, enlarged, onUnavailable) {
    const thumb = img.thumb;
    const upload = thumb.replace(/^https:\/\/thumb\.wikimedia\.org\/wikipedia\//, "https://upload.wikimedia.org/wikipedia/");
    const candidates = [...new Set(enlarged ? [img.full, thumb, upload] : [thumb, upload, img.full])];
    const node = el("img", { alt: img.title, loading: enlarged ? "eager" : "lazy" });
    let index = 0;
    node.addEventListener("error", () => {
      index++;
      if (index < candidates.length) node.src = candidates[index];
      else onUnavailable();
    });
    node.src = candidates[0];
    return node;
  }

  function imageBlock(img, onUnavailable) {
    const figure = el("figure", { class: "ex-fig" }, [
      el("figcaption", { class: "ex-cap" }, [
        img.description ? el("div", { class: "muted small", text: img.description }) : null,
        el("a", { href: img.page, target: "_blank", rel: "noopener", text: "Bildquelle ↗",
          "aria-label": `Bildquelle: ${img.source || "Wikipedia"}` }),
      ]),
    ]);
    const thumbnail = wikimediaImage(img, false, () => {
      figure.remove();
      if (onUnavailable) onUnavailable();
    });
    figure.prepend(el("button", { class: "ex-img", type: "button", "aria-label": "Bild vergrößern",
      onclick: () => openLightbox(img) }, [thumbnail]));
    return figure;
  }

  function openLightbox(img) {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const trigger = document.activeElement;
    let box = null;
    function close() {
      document.removeEventListener("keydown", onKey);
      if (box) box.remove();
      box = null;
      if (trigger?.isConnected) trigger.focus();
    }
    const image = wikimediaImage(img, true, () => image.replaceWith(el("p", { text: "Das Bild konnte nicht geladen werden." })));
    box = el("div", {
      class: "lightbox",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": img.title,
      onclick: (e) => { if (e.target === box) close(); },
    }, [
      el("div", { class: "lb-inner" }, [
        el("button", { class: "lb-close", type: "button", "aria-label": "Schließen", text: "✕", onclick: close }),
        image,
        el("div", { class: "lb-caption" }, [
          el("strong", { text: img.title }),
          img.description ? el("span", { text: " – " + img.description }) : null,
          el("div", { class: "lb-src" }, [el("a", { href: img.page, target: "_blank", rel: "noopener",
            text: `Quelle: ${img.source || "Wikipedia"} ↗` })]),
        ]),
      ]),
    ]);
    document.body.appendChild(box);
    box.querySelector(".lb-close").focus();
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

    return el("div", { class: "chart-grid" }, [
      wins.length ? el("div", { class: "card chart-card" }, [
        el("h2", { text: "Wordle: Siege nach Versuchen" }),
        dist,
      ]) : null,
      el("div", { class: "card chart-card" }, [
        el("h2", { text: "Letzte Spiele" }),
        spark,
        el("div", { class: "legend" }, [
        el("span", null, [el("i", { class: "wordle" }), "Wordle"]),
        el("span", null, [el("i", { class: "quordle" }), "Quordle"]),
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
    const winRate = finished.length ? Math.round((won.length / finished.length) * 100) + " %" : "–";

    let streak = 0, best = 0;
    finished.forEach((g) => {
      if (g.status === "won") { streak++; best = Math.max(best, streak); } else streak = 0;
    });
    const wonWordle = wordleDone.filter((g) => g.status === "won").map((g) => g.guesses.length);
    const avg = wonWordle.length ? (wonWordle.reduce((a, b) => a + b, 0) / wonWordle.length).toFixed(1) : "–";

    const wrap = el("div", { class: "view" });
    wrap.appendChild(el("header", { class: "page-heading" }, [el("h1", { text: "Verlauf & Statistik" })]));
    const history = el("section", { class: "card history-panel", "aria-labelledby": "games-heading" }, [
      el("h2", { id: "games-heading", text: "Alle Spiele" }),
      data.games.length
        ? el("div", { class: "history-list" }, data.games.slice().reverse().map(historyEntry))
        : el("p", { class: "muted", text: "Deine Partien erscheinen hier, sobald du spielst." }),
    ]);

    const progress = el("section", { class: "card history-dashboard", "aria-labelledby": "ledger-heading" }, [
      el("h2", { id: "ledger-heading", text: "Spielbilanz" }),
      el("div", { class: "stat-grid" }, [
        statBox(finished.length, "Spiele beendet"),
        statBox(won.length, "Siege"),
        statBox(winRate, "Siegquote"),
        statBox(best, "Beste Siegesserie"),
      ]),
      el("dl", { class: "history-mode-stats" }, [
        el("dt", { text: "Wordle beendet" }), el("dd", { text: wordleDone.length }),
        el("dt", { text: "Quordle beendet" }), el("dd", { text: quordleDone.length }),
        el("dt", { text: "Ø Versuche bei Wordle-Siegen" }), el("dd", { text: avg }),
      ]),
      finished.length ? statsCharts(finished) : null,
    ]);
    history.appendChild(el("div", { class: "btn-row" }, [
      el("a", { class: "btn", href: "#menu", text: "Menü" }),
      el("button", {
        class: "btn danger",
        text: "Alle Daten löschen",
        onclick: () => {
          if (window.confirm("Alle Spiele, Statistiken und gemerkten Wörter wirklich löschen?")) {
            updateData(() => {
              data = emptyData();
              input = "";
              saveData();
              showToast("Daten gelöscht.");
              render();
            });
          }
        },
      }),
    ]));
    wrap.appendChild(el("div", { class: "section-columns history-layout" }, [history, progress]));
    setView(wrap);
  }

  function historyEntry(game) {
    const summary = el("summary", null, [
      el("span", { class: "history-title" }, [
        el("strong", { text: modeLabel(game.mode) + (game.dailyDate ? " · Tagesrätsel" : "") }),
        el("span", { class: "muted", text: fmtDate(game.startedAt) }),
      ]),
      el("span", { class: "badge " + game.status, text: statusLabel(game.status) }),
      el("span", { class: "history-score", text: `${game.guesses.length}/${game.maxAttempts}`, title: "Versuche" }),
    ]);
    const details = el("details", { class: "history-entry" }, [summary]);
    details.addEventListener("toggle", () => {
      if (!details.open || details.childElementCount > 1) return;
      const body = el("div", { class: "history-body" });
      if (game.status === "playing") {
        body.appendChild(el("ul", { class: "progress-list" }, game.progress.length
          ? game.progress.map((p) => el("li", { text: `Versuch ${p.attempt}: ${p.solved} von ${game.answers.length} Wörtern gelöst (${fmtDate(p.at)})` }))
          : [el("li", { text: "Keine Versuche." })]));
        body.appendChild(el("a", { class: "btn", href: playUrl(game), text: "Fortsetzen" }));
      } else {
        body.appendChild(buildReplay(game));
        const words = game.answers.map((w, i) => game.solvedAt[i] !== null
          ? `${upper(w)} (Versuch ${game.solvedAt[i]})` : `${upper(w)} (nicht gelöst)`);
        const list = el("div", { class: "word-grid history-words", hidden: true });
        const toggle = el("button", { class: "btn small", type: "button", text: "Bedeutungen anzeigen",
          "aria-expanded": "false", onclick: () => {
            if (!list.hasChildNodes()) list.append(...game.answers.map((word) => buildExplanation(word)));
            list.hidden = !list.hidden;
            toggle.textContent = list.hidden ? "Bedeutungen anzeigen" : "Bedeutungen ausblenden";
            toggle.setAttribute("aria-expanded", !list.hidden);
          } });
        body.append(el("p", { class: "muted small", text: "Wörter: " + words.join(", ") }), toggle, list);
      }
      details.appendChild(body);
    });
    return details;
  }

  function buildReplay(game) {
    let board = 0;
    const lastAttempt = () => game.solvedAt[board] ?? game.guesses.length;
    let step = lastAttempt();
    const wrap = el("section", { class: "replay", "aria-label": "Spielanalyse" });
    const field = el("div", { class: "replay-grid" });
    const position = el("p", { class: "replay-position", "aria-live": "polite" });
    const previous = el("button", { class: "btn small", type: "button", text: "‹ Zurück", onclick: () => { step--; draw(); } });
    const next = el("button", { class: "btn small", type: "button", text: "Weiter ›", onclick: () => { step++; draw(); } });
    const picker = game.answers.length > 1 ? boardPicker(game, board, (index) => {
      board = index;
      step = lastAttempt();
      draw();
    }, "replay-pick") : null;
    const answer = el("h3", { class: "replay-answer" });
    if (picker) wrap.appendChild(picker);
    wrap.append(answer, field, el("div", { class: "replay-controls" }, [previous, position, next]));
    function draw() {
      updateBoardPicker(picker, game, board);
      answer.textContent = upper(game.answers[board]);
      const rows = [];
      game.guesses.slice(0, step).forEach((guess, index) => {
        const result = guess.results[board];
        if (!result) return;
        rows.push(el("div", { class: "row", "aria-label": `Versuch ${index + 1}` },
          Array.from(guess.word).map((letter, column) => el("span", {
            class: "tile " + result[column], text: L.displayLetter(letter),
            "aria-label": `${L.displayLetter(letter)}: ${TILE_LABELS[result[column]]}`,
          }))));
      });
      field.replaceChildren(...rows);
      const max = lastAttempt();
      position.textContent = max ? `Versuch ${step} von ${max}` : "Keine Versuche";
      previous.disabled = step <= 1;
      next.disabled = step >= max;
    }
    draw();
    return wrap;
  }

  /* ---------- Regeln ---------- */

  function renderRules() {
    document.body.classList.remove("is-play");
    const sw = (cls, text) => el("li", null, [el("span", { class: "mode-icons", style: "display:inline-flex;margin-right:8px;vertical-align:middle" }, [el("i", { class: cls, style: "width:16px;height:16px;border-radius:4px;display:block" })]), text]);
    const wrap = el("div", { class: "view card rules" }, [
      el("h1", { text: "Spielregeln" }),
      el("p", null, [el("strong", { text: "Wordle: " }), "Errate das 5-buchstabige deutsche Wort in höchstens 6 Versuchen."]),
      el("p", null, [el("strong", { text: "Quordle: " }), "Errate gleichzeitig 4 Wörter in höchstens 9 Versuchen. Jeder Tipp gilt für alle noch offenen Wörter."]),
      el("ul", { style: "list-style:none;padding:0;margin:14px 0" }, [
        sw("c", "Grün: der Buchstabe steht richtig an dieser Stelle."),
        sw("p", "Gelb: der Buchstabe kommt im Wort vor, aber an einer anderen Stelle."),
        sw("a", "Grau: der Buchstabe kommt im Wort nicht vor."),
      ]),
      el("p", { class: "muted", text: "Nur Wörter aus der Wortliste sind erlaubt. Ä, Ö, Ü und ß sind eigene Buchstaben." }),
      el("p", { class: "muted", text: "Das Tagesrätsel ist für alle gleich. Neue Rätsel gibt es um Mitternacht in Berlin. Im freien Spiel kannst du jederzeit eine neue Runde starten." }),
      el("p", { class: "muted", text: "Am Ende siehst du die Lösung und ihre Bedeutung. Alle Spiele und Versuche werden im Verlauf gespeichert." }),
      el("div", { class: "btn-row" }, [el("a", { class: "btn primary", href: "#menu", text: "Zum Menü" })]),
    ]);
    setView(wrap);
  }

  /* ---------- Маршрутизация ---------- */

  function render() {
    const h = (location.hash || "#menu").replace("#", "");
    document.querySelectorAll(".topnav a").forEach((a) => {
      const active = a.getAttribute("href") === "#" + h;
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (h === "stats") return renderStats();
    if (h === "vocab") return renderVocabulary();
    if (h === "rules") return renderRules();
    if (dictionaryState !== "ready") {
      document.body.classList.remove("is-play");
      const text = dictionaryState === "loading"
        ? "Wörterbuch wird geladen …"
        : "Die Wortliste konnte nicht geladen werden. Bitte lade die Seite neu.";
      return setView(el("p", { class: "loading", role: "status", text }));
    }
    if (h === "play" || h.startsWith("play/")) return renderPlay();
    return renderMenu();
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.defaultPrevented || document.querySelector(".lightbox")) return;
    if (dictionaryState !== "ready") return;
    const g = playingGame();
    if (!g) return;
    if (e.key === "Enter" && input.length < L.WORD_LENGTH && e.target.closest?.("button:not(.key), a, summary")) return;
    if (e.key === "Enter") { e.preventDefault(); return handleKey("Enter"); }
    if (e.key === "Backspace") { e.preventDefault(); return handleKey("Backspace"); }
    if (/^[a-zA-ZäöüÄÖÜßẞ]$/.test(e.key)) { e.preventDefault(); handleKey(e.key); }
  });

  window.addEventListener("hashchange", render);
  compactBoards.addEventListener("change", () => {
    const game = playingGame();
    if (game?.mode === "quordle") drawBoards(game);
  });
  landscapePlay.addEventListener("change", () => {
    const game = playingGame();
    if (game) scrollToBoard(game);
  });
  function refreshMenuDate() {
    if (dictionaryState === "ready" && (!location.hash || location.hash === "#menu") && menuDay !== L.dailyDate()) renderMenu();
  }
  window.addEventListener("focus", refreshMenuDate);
  setInterval(refreshMenuDate, 60_000);
  window.addEventListener("storage", (event) => {
    if (sessionOnly || (event.key !== STORAGE_KEY && event.key !== null)) return;
    const latest = loadData();
    if (!latest) return;
    const currentId = playingGame()?.id;
    data = latest;
    if (currentId !== playingGame()?.id) input = "";
    render();
  });

  /* ---------- Старт ---------- */

  async function init() {
    const loadWords = async (file) => {
      const response = await fetch(file);
      if (!response.ok) throw new Error("HTTP " + response.status);
      const list = await response.json();
      if (!Array.isArray(list) || !list.every(L.isWellFormed) || new Set(list).size !== list.length) {
        throw new Error("Invalid word list: " + file);
      }
      return list;
    };
    render();
    loadWords("data/daily-words.json").then((words) => {
      if (words.length < L.MODES.quordle.boards) throw new Error("The daily word pool is incomplete.");
      DAILY_WORDS = words;
      dailyState = "ready";
    }).catch(() => { dailyState = "error"; }).finally(() => {
      const panel = app.querySelector(".view-menu .daily-panel");
      if (panel) {
        const now = new Date();
        panel.replaceWith(dailyPanel(L.dailyDate(now), now));
      }
    });
    try {
      const [answers, guesses] = await Promise.all([
        loadWords("data/answers.json"),
        loadWords("data/guesses.json"),
      ]);
      const guessSet = new Set(guesses);
      if (answers.length < L.MODES.quordle.boards || !answers.every((word) => guessSet.has(word))) {
        throw new Error("The answer list is incomplete.");
      }
      ANSWERS = answers;
      GUESS_SET = guessSet;
      dictionaryState = "ready";
    } catch {
      dictionaryState = "error";
    }
    if (!["#stats", "#rules", "#vocab"].includes(location.hash)) render();
  }

  function buildBackground() {
    const background = document.getElementById("bg-letters");
    if (!background) return;
    const letters = [..."WORDLEÄÖÜẞQAT"];
    const random = (min, max) => Math.random() * (max - min) + min;
    for (let i = 0; i < 16; i++) {
      const letter = el("span", { text: letters[i % letters.length] });
      const properties = {
        "--x": random(0, 96).toFixed(1) + "%",
        "--y": random(0, 96).toFixed(1) + "%",
        "--size": Math.round(random(28, 96)) + "px",
        "--opacity": random(.04, .09).toFixed(3),
        "--duration": random(14, 28).toFixed(1) + "s",
        "--phase": random(-12, 0).toFixed(1) + "s",
        "--dx": Math.round(random(-60, 60)) + "px",
        "--dy": Math.round(random(-60, 60)) + "px",
        "--angle": Math.round(random(-25, 25)) + "deg",
      };
      for (const [property, value] of Object.entries(properties)) letter.style.setProperty(property, value);
      background.appendChild(letter);
    }
  }

  buildBackground();
  init();
})();
