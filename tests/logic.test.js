const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/logic.js");
const dailyPool = require("../data/daily-words.json");
const { RESULT: R } = L;

test("полностью правильное слово", () => {
  assert.deepEqual(L.evaluateGuess("tisch", "tisch"), [R.CORRECT, R.CORRECT, R.CORRECT, R.CORRECT, R.CORRECT]);
});

test("серые и зелёные буквы", () => {
  // Ответ "lesen", попытка "leben": b отсутствует в ответе
  assert.deepEqual(L.evaluateGuess("leben", "lesen"), [R.CORRECT, R.CORRECT, R.ABSENT, R.CORRECT, R.CORRECT]);
});

test("жёлтые буквы: буква есть, но на другом месте", () => {
  // Ответ "tisch", попытка "stuhl": s, t, h есть в другом месте -> жёлтые; u и l отсутствуют
  assert.deepEqual(L.evaluateGuess("stuhl", "tisch"), [R.PRESENT, R.PRESENT, R.ABSENT, R.PRESENT, R.ABSENT]);
});

test("повторяющиеся буквы: лишние не подсвечиваются", () => {
  // Ответ "abend" (одна "e" на позиции 2), попытка "eeeee": только зелёная e
  assert.deepEqual(L.evaluateGuess("eeeee", "abend"), [R.ABSENT, R.ABSENT, R.CORRECT, R.ABSENT, R.ABSENT]);
});

test("повтор в попытке: жёлтая только до количества в ответе", () => {
  // Ответ "rette" (r,e,t,t,e), попытка "leere" (l,e,e,r,e):
  // две зелёные e (позиции 1 и 4), третья e — серая, r — жёлтая
  assert.deepEqual(L.evaluateGuess("leere", "rette"), [R.ABSENT, R.CORRECT, R.ABSENT, R.PRESENT, R.CORRECT]);
});

test("umlaute считаются отдельными буквами", () => {
  // Ответ "apfel", попытка "äpfel": ä отсутствует
  assert.deepEqual(L.evaluateGuess("äpfel", "apfel"), [R.ABSENT, R.CORRECT, R.CORRECT, R.CORRECT, R.CORRECT]);
});

test("normalizeWord: нижний регистр и NFC", () => {
  assert.equal(L.normalizeWord("  TÜRME "), "türme");
});

test("isWellFormed: 5 букв немецкого алфавита, включая ß", () => {
  assert.ok(L.isWellFormed("bäume"));
  assert.ok(L.isWellFormed("weißt"));
  assert.ok(!L.isWellFormed("weiß!"));
  assert.ok(!L.isWellFormed("heiß"));
  assert.ok(!L.isWellFormed("haus"));
});

test("pickWords: различные слова и исключение использованных", () => {
  const pool = ["abend", "bauer", "conte", "dorfs", "eimer", "fisch"];
  const used = ["abend", "bauer"];
  for (let i = 0; i < 50; i++) {
    const { words, reset } = L.pickWords(pool, 2, used);
    assert.equal(reset, false);
    assert.equal(new Set(words).size, 2);
    words.forEach((w) => assert.ok(!used.includes(w)));
  }
});

test("pickWords: при исчерпании пула история сбрасывается", () => {
  const pool = ["abend", "bauer", "conte"];
  const { words, reset } = L.pickWords(pool, 2, ["abend", "bauer", "conte"]);
  assert.equal(reset, true);
  assert.equal(words.length, 2);
});

test("pickWords: Quordle использует последнее новое слово перед повторениями", () => {
  const pool = ["abend", "bauer", "eimer", "fisch"];
  const { words, reset } = L.pickWords(pool, 4, pool.slice(0, 3));
  assert.equal(reset, true);
  assert.equal(words[0], "fisch");
  assert.equal(new Set(words).size, 4);
});

test("pickWords: пустой или слишком маленький пул не создаёт пустых ответов", () => {
  assert.throws(() => L.pickWords([], 1, []), RangeError);
  assert.throws(() => L.pickWords(["abend"], 4, []), RangeError);
});

test("keyboardStatuses: лучший результат по всем доскам", () => {
  const st = L.keyboardStatuses([
    { word: "tisch", results: [[R.PRESENT, R.ABSENT, R.ABSENT, R.ABSENT, R.ABSENT], null] },
    { word: "tanze", results: [[R.CORRECT, R.ABSENT, R.ABSENT, R.ABSENT, R.ABSENT], [R.ABSENT, R.ABSENT, R.ABSENT, R.ABSENT, R.ABSENT]] },
  ]);
  assert.equal(st["t"], R.CORRECT);
  assert.equal(st["i"], R.ABSENT);
  assert.equal(st["s"], R.ABSENT);
});

test("цвет клавиши для отдельной доски не зависит от остальных", () => {
  const guesses = [{
    word: "tisch",
    results: ["tisch", "apfel", "stuhl"].map((answer) => L.evaluateGuess("tisch", answer)),
  }];
  assert.equal(L.keyboardStatuses(guesses, 0).t, R.CORRECT);
  assert.equal(L.keyboardStatuses(guesses, 1).t, R.ABSENT);
  assert.equal(L.keyboardStatuses(guesses, 2).t, R.PRESENT);
});

test("Tagesrätsel wechselt mit Berliner Mitternacht und Sommerzeit", () => {
  assert.equal(L.dailyDate(new Date("2026-03-29T21:59:59Z")), "2026-03-29");
  assert.equal(L.dailyDate(new Date("2026-03-29T22:00:00Z")), "2026-03-30");
  assert.equal(L.dailyDate(new Date("2026-10-25T22:59:59Z")), "2026-10-25");
  assert.equal(L.dailyDate(new Date("2026-10-25T23:00:00Z")), "2026-10-26");
});

test("Tagesrätsel verwenden den veröffentlichten Vorrat in stabiler Reihenfolge", () => {
  assert.deepEqual(L.dailyWords(dailyPool, "wordle", "2026-11-21"), ["dunst"]);
  const today = L.dailyWords(dailyPool, "quordle", "2026-11-21");
  assert.deepEqual(today, ["weihe", "zwang", "alibi", "hölle"]);
  const tomorrow = L.dailyWords(dailyPool, "quordle", "2026-11-22");
  assert.equal(new Set([...today, ...tomorrow]).size, 8);
  assert.equal(L.dailyWords(dailyPool, "quordle", "2026-11-19").length, 4);
});

test("geteilte Tagesergebnisse enthalten nur Bewertungen und keine Buchstaben", () => {
  const game = {
    mode: "wordle", dailyDate: "2026-11-21", status: "won", maxAttempts: 6,
    answers: ["dunst"], solvedAt: [2],
    guesses: ["tisch", "dunst"].map((word) => ({ word, results: [L.evaluateGuess(word, "dunst")] })),
  };
  assert.equal(L.dailyShareText(game), "WordleDeutsch · Wordle · 2026-11-21\n2/6\n\n🟨⬛🟨⬛⬛\n🟩🟩🟩🟩🟩");
});
