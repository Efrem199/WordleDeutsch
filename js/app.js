/*
 * Wordle & Quordle auf Deutsch — UI, Speicherung und Navigation.
 */
(function () {
  const L = window.WordleLogic;
  const EX = window.WordExplain;
  const STORAGE_KEY = "wordle-deutsch-v1";

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");

  let ANSWERS = [];
  let GUESS_SET = new Set();
  let input = ""; // aktuelle Eingabe (nicht gespeichert)
  let toastTimer = null;

  /* ---------- Speicherung ---------- */

  function loadData() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (d && Array.isArray(d.games) && Array.isArray(d.used)) return d;
    } catch (e) {
      /* повреждённые данные — начинаем заново */
    }
    return { version: 1, games: [], used: [] };
  }
  let data = loadData();

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function playingGame() {
    return data.games.find((g) => g.status === "playing") || null;
  }

  function gameById(id) {
    return data.games.find((g) => g.id === id) || null;
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
    const game = {
      id: newId(),
      mode,
      status: "playing",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      maxAttempts: L.MODES[mode].maxAttempts,
      answers: words,
      solvedAt: words.map(() => null), // номер попытки, на которой слово угадано
      guesses: [], // { word, results: [результат по доске | null] }
      progress: [], // { attempt, solved, at } — сколько слов угадано на каждой попытке
    };
    data.games.push(game);
    saveData();
    input = "";
    return game;
  }

  /* ---------- Игровая логика ---------- */

  function submitGuess(game) {
    if (input.length < L.WORD_LENGTH) return shakeRow("Zu wenig Buchstaben.");
    const word = input;
    if (!GUESS_SET.has(word)) return shakeRow("Nicht in der Wortliste.");
    if (game.guesses.some((g) => g.word === word)) return shakeRow("Dieses Wort hast du schon getippt.");

    const attempt = game.guesses.length + 1;
    const results = game.answers.map((ans, i) =>
      game.solvedAt[i] === null ? L.evaluateGuess(word, ans) : null
    );
    game.answers.forEach((ans, i) => {
      if (game.solvedAt[i] === null && word === ans) game.solvedAt[i] = attempt;
    });
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
    render();
    if (game.status !== "playing") {
      const msg = game.status === "won" ? "Glückwunsch!" : "Leider verloren.";
      showToast(msg);
    }
  }

  function finishGame(game, status) {
    game.status = status;
    game.finishedAt = new Date().toISOString();
  }

  /* ---------- Hilfsfunktionen UI ---------- */

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
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
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  }

  function shakeRow(msg) {
    showToast(msg);
    const row = document.querySelector(".row.current");
    if (row) {
      row.classList.remove("shake");
      void row.offsetWidth;
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

  /* ---------- Экран: меню ---------- */

  function renderMenu() {
    const cur = playingGame();
    const menu = el("div", { class: "menu" });
    menu.appendChild(el("h1", { text: "Wordle & Quordle auf Deutsch" }));
    menu.appendChild(
      el("p", { class: "muted", style: "text-align:center", text: "Errate das deutsche Wort in 6 Versuchen (Wordle) oder vier Wörter gleichzeitig in 9 Versuchen (Quordle)." })
    );
    if (cur) {
      const info = `${modeLabel(cur.mode)} · Versuch ${cur.guesses.length}/${cur.maxAttempts} · ${cur.solvedAt.filter((x) => x !== null).length}/${cur.answers.length} gelöst`;
      menu.appendChild(el("a", { class: "btn primary", href: "#play", text: "Laufendes Spiel fortsetzen" }));
      menu.appendChild(el("p", { class: "muted", style: "text-align:center; margin:-4px 0 0", text: info }));
    }
    menu.appendChild(
      el("button", { class: "btn" + (cur ? "" : " primary"), text: "Wordle spielen (1 Wort)", onclick: () => newGame("wordle") })
    );
    menu.appendChild(
      el("button", { class: "btn", text: "Quordle spielen (4 Wörter)", onclick: () => newGame("quordle") })
    );
    menu.appendChild(el("a", { class: "btn", href: "#stats", text: "Verlauf & Statistik" }));
    menu.appendChild(el("a", { class: "btn", href: "#rules", text: "Spielregeln" }));
    menu.appendChild(
      el("p", { class: "muted", style: "text-align:center", text: `Wortliste: ${GUESS_SET.size} gültige Wörter · ${ANSWERS.length} mögliche Lösungen` })
    );
    setView(menu);
  }

  function newGame(mode) {
    const cur = playingGame();
    if (cur && !window.confirm("Das laufende Spiel wird als abgebrochen gespeichert. Neues Spiel starten?")) return;
    startNewGame(mode);
    location.hash = "#play";
    if (location.hash === "#play") render();
  }

  /* ---------- Экран: игра ---------- */

  function renderPlay() {
    const game = playingGame();
    const active = game && game.status === "playing" ? game : null;

    // Нет активной игры — показываем итог последней завершённой
    const g = active || lastFinishedGame();
    if (!g) return renderMenu();

    const wrap = el("div");
    const head = el("div", { class: "game-head" }, [
      el("div", { class: "info", text: `${modeLabel(g.mode)} · Versuch ${Math.min(g.guesses.length + (g.status === "playing" ? 1 : 0), g.maxAttempts)} von ${g.maxAttempts}` }),
      el("div", { class: "btn-row", style: "margin:0" }, [
        el("a", { class: "btn small", href: "#menu", text: "Menü" }),
        g.status === "playing"
          ? el("button", { class: "btn small danger", text: "Neues Spiel", onclick: () => newGame(g.mode) })
          : el("button", { class: "btn small primary", text: "Neue Runde", onclick: () => newGame(g.mode) }),
      ]),
    ]);
    wrap.appendChild(head);

    const boards = el("div", { class: "boards " + (g.answers.length > 1 ? "quad" : "single"), id: "boards" });
    wrap.appendChild(boards);
    wrap.appendChild(buildKeyboard(g));

    if (g.status !== "playing") {
      wrap.appendChild(buildResult(g));
    }
    setView(wrap);
    drawBoards(g);
  }

  function lastFinishedGame() {
    const done = data.games.filter((x) => x.status !== "playing" && x.status !== "aborted");
    return done.length ? done[done.length - 1] : null;
  }

  function drawBoards(g) {
    const boards = document.getElementById("boards");
    if (!boards) return;
    boards.innerHTML = "";
    const n = g.answers.length;
    const isPlaying = g.status === "playing";
    const ended = !isPlaying;

    g.answers.forEach((ans, b) => {
      const solvedAt = g.solvedAt[b];
      const boardEl = el("div", { class: "board" });
      let title = n > 1 ? `Wort ${b + 1}` : "";
      if (n > 1) {
        if (solvedAt !== null) title += ` · ✔ ${upper(ans)} (Versuch ${solvedAt})`;
        else if (ended) title += ` · ${upper(ans)}`;
      }
      boardEl.appendChild(el("div", { class: "board-title" + (solvedAt !== null ? " solved" : ""), text: title }));

      const rows = el("div", { class: "rows" });
      for (let r = 0; r < g.maxAttempts; r++) {
        const row = el("div", { class: "row" });
        if (r < g.guesses.length) {
          const gu = g.guesses[r];
          const res = gu.results[b];
          if (res) {
            Array.from(gu.word).forEach((ch, i) => {
              row.appendChild(el("div", { class: `tile ${res[i]} flip`, style: `animation-delay:${i * 0.1}s`, text: L.displayLetter(ch) }));
            });
          } else {
            row.classList.add("frozen");
            for (let i = 0; i < L.WORD_LENGTH; i++) row.appendChild(el("div", { class: "tile" }));
          }
        } else if (r === g.guesses.length && isPlaying && solvedAt === null) {
          row.classList.add("current");
          const letters = Array.from(input);
          for (let i = 0; i < L.WORD_LENGTH; i++) {
            const ch = letters[i];
            row.appendChild(el("div", { class: "tile" + (ch ? " filled" : ""), text: ch ? L.displayLetter(ch) : "" }));
          }
        } else {
          if (solvedAt !== null || (ended && n > 1)) row.classList.add("frozen");
          for (let i = 0; i < L.WORD_LENGTH; i++) row.appendChild(el("div", { class: "tile" }));
        }
        rows.appendChild(row);
      }
      boardEl.appendChild(rows);
      boards.appendChild(boardEl);
    });
    // Einzel-Wordle: Lösung erst nach Spielende zeigen (über Ergebnisfeld)
    boards.classList.toggle("single", n === 1);
    refreshKeyboard(g);
  }

  function buildKeyboard(g) {
    const kb = el("div", { class: "keyboard", id: "keyboard" });
    L.KEYBOARD_ROWS.forEach((keys, idx) => {
      const row = el("div", { class: "kb-row" });
      if (idx === 2) {
        row.appendChild(el("button", { class: "key wide", text: "Enter", "data-key": "Enter", onclick: () => handleKey("Enter") }));
      }
      keys.forEach((k) => {
        row.appendChild(el("button", { class: "key", text: k.toUpperCase(), "data-key": k, onclick: () => handleKey(k) }));
      });
      if (idx === 2) {
        row.appendChild(el("button", { class: "key wide", text: "⌫", "data-key": "Backspace", onclick: () => handleKey("Backspace") }));
      }
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
    }
    drawBoards(g);
  }

  function buildResult(g) {
    const solved = g.solvedAt.filter((x) => x !== null).length;
    const won = g.status === "won";
    const box = el("div", { class: "card result" });
    box.appendChild(el("h2", { text: won ? "Geschafft! 🎉" : "Schade, das war's." }));
    box.appendChild(
      el("p", {
        text: `${solved} von ${g.answers.length} ${g.answers.length > 1 ? "Wörtern" : "Wort"} erraten in ${g.guesses.length} von ${g.maxAttempts} Versuchen.`,
      })
    );
    box.appendChild(el("h2", { text: g.answers.length > 1 ? "Die Lösungen und ihre Bedeutung" : "Die Lösung und ihre Bedeutung" }));
    g.answers.forEach((ans) => box.appendChild(buildExplanation(ans)));
    box.appendChild(
      el("div", { class: "btn-row" }, [
        el("button", { class: "btn primary", text: "Neue Runde", onclick: () => newGame(g.mode) }),
        el("a", { class: "btn", href: "#stats", text: "Verlauf ansehen" }),
        el("a", { class: "btn", href: "#menu", text: "Zum Menü" }),
      ])
    );
    return box;
  }

  function buildExplanation(word) {
    const holder = el("div", { class: "explain" }, [
      el("span", { class: "word", text: upper(word) }),
      el("span", { class: "muted", text: "  lädt Bedeutung …" }),
    ]);
    EX.getExplanation(word).then((r) => {
      holder.innerHTML = "";
      holder.appendChild(el("span", { class: "word", text: upper(word) }));
      if (r.wortart) holder.appendChild(el("span", { class: "pos", text: r.wortart }));
      if (r.ok) {
        const ol = el("ol");
        r.defs.forEach((d) => ol.appendChild(el("li", { text: d })));
        holder.appendChild(ol);
      } else {
        holder.appendChild(el("p", { class: "muted", text: "Keine Bedeutung gefunden (offline oder nicht im Wiktionary)." }));
      }
      holder.appendChild(el("a", { href: r.url, target: "_blank", rel: "noopener", text: "Wiktionary ↗" }));
    });
    return holder;
  }

  /* ---------- Экран: статистика и история ---------- */

  function renderStats() {
    const finished = data.games.filter((g) => g.status === "won" || g.status === "lost");
    const won = finished.filter((g) => g.status === "won");
    const wordleDone = finished.filter((g) => g.mode === "wordle");
    const quordleDone = finished.filter((g) => g.mode === "quordle");
    const wins = won.length;
    const winRate = finished.length ? Math.round((wins / finished.length) * 100) : 0;

    // Серия побед подряд (по порядку завершения)
    let streak = 0, best = 0;
    finished.forEach((g) => {
      if (g.status === "won") { streak++; best = Math.max(best, streak); } else streak = 0;
    });
    const avgWordle = wordleDone.filter((g) => g.status === "won").map((g) => g.guesses.length);
    const avg = avgWordle.length ? (avgWordle.reduce((a, b) => a + b, 0) / avgWordle.length).toFixed(1) : "–";

    const wrap = el("div");
    wrap.appendChild(el("h1", { text: "Verlauf & Statistik" }));
    const grid = el("div", { class: "stat-grid" }, [
      statBox(finished.length, "Spiele beendet"),
      statBox(wins, "Siege"),
      statBox(winRate + " %", "Siegquote"),
      statBox(best, "Beste Siegesserie"),
      statBox(wordleDone.length, "Wordle beendet"),
      statBox(quordleDone.length, "Quordle beendet"),
      statBox(avg, "Ø Versuche bei Wordle-Sieg"),
    ]);
    wrap.appendChild(grid);

    wrap.appendChild(el("h2", { text: "Alle Spiele" }));
    if (!data.games.length) {
      wrap.appendChild(el("p", { class: "muted", text: "Noch keine Spiele. Starte im Menü eine Runde!" }));
    } else {
      const tbl = el("table");
      tbl.appendChild(el("thead", null, [el("tr", null, ["Datum", "Modus", "Ergebnis", "Gelöst", "Details"].map((t) => el("th", { text: t })))]));
      const tb = el("tbody");
      data.games.slice().reverse().forEach((g) => {
        const solved = g.solvedAt.filter((x) => x !== null).length;
        const detailsList = el("ul", { class: "progress-list" });
        if (!g.progress.length) detailsList.appendChild(el("li", { text: "Keine Versuche." }));
        g.progress.forEach((p) => {
          detailsList.appendChild(el("li", { text: `Versuch ${p.attempt}: ${p.solved} von ${g.answers.length} Wörtern gelöst (${fmtDate(p.at)})` }));
        });
        const wordsBox = el("div", { class: "card", style: "margin:8px 0 0; padding:10px" });
        wordsBox.appendChild(el("div", { class: "muted", text: "Wörter: " + g.answers.map((w, i) => `${upper(w)}${g.solvedAt[i] !== null ? " (Versuch " + g.solvedAt[i] + ")" : " (nicht gelöst)"}`).join(", ") }));
        const explBtn = el("button", { class: "btn small", text: "Bedeutungen anzeigen" });
        const explBox = el("div");
        explBtn.addEventListener("click", () => {
          explBtn.remove();
          g.answers.forEach((w) => explBox.appendChild(buildExplanation(w)));
        });
        wordsBox.appendChild(el("div", { style: "margin-top:6px" }, [explBtn]));
        wordsBox.appendChild(explBox);

        const details = el("details", null, [el("summary", { text: "Verlauf" }), detailsList, wordsBox]);
        tb.appendChild(el("tr", null, [
          el("td", { text: fmtDate(g.startedAt) }),
          el("td", { text: modeLabel(g.mode) }),
          el("td", null, [el("span", { class: "badge " + g.status, text: statusLabel(g.status) })]),
          el("td", { text: `${solved}/${g.answers.length} · ${g.guesses.length}/${g.maxAttempts} Versuche` }),
          el("td", null, [details]),
        ]));
      });
      tbl.appendChild(tb);
      const scroll = el("div", { style: "overflow-x:auto" }, [tbl]);
      wrap.appendChild(scroll);
    }

    wrap.appendChild(
      el("div", { class: "btn-row" }, [
        el("a", { class: "btn", href: "#menu", text: "Zum Menü" }),
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
      ])
    );
    setView(wrap);
  }

  function statBox(num, label) {
    return el("div", { class: "stat" }, [el("div", { class: "num", text: String(num) }), el("div", { class: "lbl", text: label })]);
  }

  /* ---------- Экран: правила ---------- */

  function renderRules() {
    const wrap = el("div", { class: "card" });
    wrap.innerHTML = `
      <h1>Spielregeln</h1>
      <p><strong>Wordle:</strong> Errate das 5-buchstabige deutsche Wort in höchstens 6 Versuchen.</p>
      <p><strong>Quordle:</strong> Errate gleichzeitig 4 Wörter in höchstens 9 Versuchen. Jeder Tipp gilt für alle noch offenen Wörter.</p>
      <ul>
        <li>Nur echte Wörter aus dem Wörterbuch sind erlaubt (ÄÖÜ sind eigene Buchstaben, ß kommt nicht vor).</li>
        <li><span style="color:#6aaa64"><strong>Grün</strong></span>: Der Buchstabe ist richtig und an der richtigen Stelle.</li>
        <li><span style="color:#c9b458"><strong>Gelb</strong></span>: Der Buchstabe kommt im Wort vor, aber an einer anderen Stelle.</li>
        <li><span style="color:#9a9a9e"><strong>Grau</strong></span>: Der Buchstabe kommt im Wort nicht vor.</li>
      </ul>
      <p class="muted">Am Ende des Spiels siehst du die Lösung und ihre Bedeutung. Alle Spiele und Versuche werden im Verlauf gespeichert.</p>
      <div class="btn-row"><a class="btn" href="#menu">Zum Menü</a></div>`;
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
    const h = (location.hash || "").replace("#", "");
    if (h !== "play") return;
    const g = playingGame();
    if (!g) return;
    if (e.key === "Enter") { e.preventDefault(); handleKey("Enter"); return; }
    if (e.key === "Backspace") { e.preventDefault(); handleKey("Backspace"); return; }
    if (/^[a-zA-ZäöüÄÖÜ]$/.test(e.key)) {
      e.preventDefault();
      handleKey(e.key);
    }
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
})();
