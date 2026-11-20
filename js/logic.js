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

  // Немецкая раскладка QWERTZ; ß в клавиатуре нет, поэтому в словаре ß не используется.
  const KEYBOARD_ROWS = [
    ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p", "ü"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ö", "ä"],
    ["y", "x", "c", "v", "b", "n", "m"],
  ];

  const MODES = {
    wordle: { label: "Wordle", boards: 1, maxAttempts: 6 },
    quordle: { label: "Quordle", boards: 4, maxAttempts: 9 },
  };

  const RESULT = { CORRECT: "correct", PRESENT: "present", ABSENT: "absent" };

  /** Нормализация: NFC, нижний регистр, без пробелов по краям. */
  function normalizeWord(s) {
    return String(s).normalize("NFC").toLocaleLowerCase(LOCALE).trim();
  }

  /** Буква в верхнем регистре; ẞ для ß (на случай отображения). */
  function displayLetter(ch) {
    if (ch === "ß") return "ẞ";
    return ch.toLocaleUpperCase(LOCALE);
  }

  /** Допустимый формат слова: ровно 5 букв немецкого алфавита (с ÄÖÜ, без ß). */
  function isWellFormed(word) {
    return /^[a-zäöü]{5}$/.test(word);
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

  /**
   * Выбирает `count` различных слов из пула, которых ещё не было (used).
   * Если непоказанных слов не хватает, история сбрасывается и выбор идёт из всего пула.
   * Возвращает { words, reset }.
   */
  function pickWords(pool, count, used) {
    const usedSet = new Set(used || []);
    let candidates = pool.filter((w) => !usedSet.has(w));
    let reset = false;
    if (candidates.length < count) {
      candidates = pool.slice();
      reset = true;
    }
    const words = [];
    for (let i = 0; i < count; i++) {
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
  function keyboardStatuses(guesses) {
    const rank = { [RESULT.CORRECT]: 3, [RESULT.PRESENT]: 2, [RESULT.ABSENT]: 1 };
    const status = {};
    for (const gu of guesses) {
      for (const res of gu.results) {
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
    keyboardStatuses,
    summarizeProgress,
  };
});
