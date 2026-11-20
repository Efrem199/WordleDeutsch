const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/logic.js");
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
