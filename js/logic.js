/*
 * Чистая игровая логика (без DOM), используется и в браузере, и в тестах Node.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WordleLogic = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const WORD_LENGTH = 5;
  const LOCALE = "de-DE";

  // Немецкая раскладка QWERTZ с ß (ß — отдельная клавиша в нижнем ряду).
  const KEYBOARD_ROWS = [
    ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p", "ü"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ö", "ä"],
    ["y", "x", "c", "v", "b", "n", "m", "ß"],
  ];

  const MODES = {
    wordle: { label: "Wordle", boards: 1, maxAttempts: 6 },
    quordle: { label: "Quordle", boards: 4, maxAttempts: 9 },
  };

  const RESULT = { CORRECT: "correct", PRESENT: "present", ABSENT: "absent" };
  const DAY_MS = 86400000;
  const DAILY_EPOCH = Date.UTC(2026, 10, 20);
  const dailyCalendar = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  });

  function dailyDate(now = new Date()) {
    const parts = Object.fromEntries(dailyCalendar.formatToParts(now).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function dailyWords(pool, mode, date) {
    const count = MODES[mode].boards;
    const daysPerCycle = Math.floor(pool.length / count);
    if (daysPerCycle < 1) throw new RangeError("Incomplete daily word pool.");
    const day = (Date.parse(date + "T00:00:00Z") - DAILY_EPOCH) / DAY_MS;
    const cycle = Math.floor(day / daysPerCycle);
    const offset = (day - cycle * daysPerCycle) * count;
    const words = pool.slice();
    // The pool order and shuffle are part of the public daily schedule.
    let state = ((count === 1 ? 0x71cf4b91 : 0xe13ca728) ^ cycle) >>> 0;
    for (let i = words.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [words[i], words[j]] = [words[j], words[i]];
    }
    return words.slice(offset, offset + count);
  }

  function dailyShareText(game) {
    const square = { [RESULT.CORRECT]: "🟩", [RESULT.PRESENT]: "🟨", [RESULT.ABSENT]: "⬛" };
    const solved = game.solvedAt.filter(Number.isInteger).length;
    const score = game.mode === "wordle"
      ? `${game.status === "won" ? game.guesses.length : "X"}/${game.maxAttempts}`
      : `${solved}/${game.answers.length} Wörter · ${game.guesses.length}/${game.maxAttempts}`;
    const grids = game.answers.map((_, board) => game.guesses.map(({ results }) => results[board])
      .filter(Boolean).map((row) => row.map((color) => square[color]).join("")).join("\n"));
    return [`WordleDeutsch · ${MODES[game.mode].label} · ${game.dailyDate}`, score, "", grids.join("\n\n")].join("\n");
  }

  /** Нормализация: NFC, нижний регистр, без пробелов по краям. */
  function normalizeWord(s) {
    return String(s).normalize("NFC").toLocaleLowerCase(LOCALE).trim();
  }

  /** Буква в верхнем регистре; ẞ для ß (на случай отображения). */
  function displayLetter(ch) {
    if (ch === "ß") return "ẞ";
    return ch.toLocaleUpperCase(LOCALE);
  }

  /** Допустимый формат слова: ровно 5 букв немецкого алфавита (a–z, ÄÖÜ, ß). */
  function isWellFormed(word) {
    return typeof word === "string" && /^[a-zäöüß]{5}$/.test(word);
  }

  /**
   * Стандартная оценка попытки (как в Wordle), включая корректную обработку повторных букв:
   * сначала зелёные (совпадение места), затем жёлтые (буква есть в другом месте, с учётом количества).
   * Возвращает массив из 5 значений RESULT.
   */
  function evaluateGuess(guess, answer) {
    const g = Array.from(guess);
    const a = Array.from(answer);
    const result = new Array(a.length).fill(RESULT.ABSENT);
    const remaining = {};

    for (let i = 0; i < a.length; i++) {
      if (g[i] === a[i]) {
        result[i] = RESULT.CORRECT;
      } else {
        remaining[a[i]] = (remaining[a[i]] || 0) + 1;
      }
    }
    for (let i = 0; i < a.length; i++) {
      if (result[i] === RESULT.CORRECT) continue;
      if (remaining[g[i]] > 0) {
        result[i] = RESULT.PRESENT;
        remaining[g[i]]--;
      }
    }
    return result;
  }

  /** Случайное целое в [0, max) — криптографически, если доступно. */
  function randomInt(max) {
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      // отбрасываем смещённые значения
      const limit = Math.floor(0x100000000 / max) * max;
      let x;
      do {
        c.getRandomValues(buf);
        x = buf[0];
      } while (x >= limit);
      return x % max;
    }
    return Math.floor(Math.random() * max);
  }

  /** При смене цикла сначала расходует оставшиеся слова старого пула. */
  function pickWords(pool, count, used) {
    if (!Number.isInteger(count) || count < 1 || count > pool.length) {
      throw new RangeError("The answer pool cannot fill the requested boards.");
    }
    const usedSet = new Set(used || []);
    let candidates = pool.filter((w) => !usedSet.has(w));
    const reset = candidates.length < count;
    const words = [];
    for (let i = 0; i < count; i++) {
      if (!candidates.length) candidates = pool.filter((w) => !words.includes(w));
      const idx = randomInt(candidates.length);
      words.push(candidates[idx]);
      candidates.splice(idx, 1);
    }
    return { words, reset };
  }

  /**
   * Статус каждой буквы на клавиатуре по всем досках (лучший результат побеждает):
   * correct > present > absent. Буквы без оценки отсутствуют в объекте.
   */
  function keyboardStatuses(guesses, board) {
    const rank = { [RESULT.CORRECT]: 3, [RESULT.PRESENT]: 2, [RESULT.ABSENT]: 1 };
    const status = {};
    for (const gu of guesses) {
      for (const res of board === undefined ? gu.results : [gu.results[board]]) {
        if (!res) continue;
        Array.from(gu.word).forEach((ch, i) => {
          const prev = status[ch];
          if (!prev || rank[res[i]] > rank[prev]) status[ch] = res[i];
        });
      }
    }
    return status;
  }

  /** Сводка результата игры: сколько слов угадано на каждой попытке. */
  function summarizeProgress(progress) {
    return (progress || []).map((p) => ({ attempt: p.attempt, solved: p.solved }));
  }

  return {
    WORD_LENGTH,
    LOCALE,
    KEYBOARD_ROWS,
    MODES,
    RESULT,
    normalizeWord,
    displayLetter,
    isWellFormed,
    evaluateGuess,
    pickWords,
    dailyDate,
    dailyWords,
    dailyShareText,
    keyboardStatuses,
    summarizeProgress,
  };
});
