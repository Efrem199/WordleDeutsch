const test = require("node:test");
const assert = require("node:assert/strict");
const guesses = require("../data/guesses.json");
const answers = require("../data/answers.json");
const daily = require("../data/daily-words.json");

test("оба списка содержат ровно по одной записи на каждое слово из пяти букв", () => {
  for (const list of [answers, guesses, daily]) {
    assert.ok(list.every((w) => /^[a-zäöüß]{5}$/.test(w)));
    assert.equal(list.length, new Set(list).size);
  }
  assert.ok(answers.length >= 4);
  assert.ok(daily.length >= 4);
});

test("регрессия: обычные слова из словаря принимаются", () => {
  const set = new Set(guesses);
  for (const w of ["katze", "tisch", "hunde", "wurst", "essen", "schön", "heißt", "lerne", "stehe", "bilde", "kenne", "lobst"]) {
    assert.ok(set.has(w), w);
  }
});

test("Hunspell: основы, которым нужен аффикс, не считаются словами", () => {
  for (const w of ["brech", "lösch", "tauch"]) assert.ok(!guesses.includes(w), w);
});

test("загадки: обычные существительные, без имён, географии и падежных форм", () => {
  for (const w of ["katze", "robbe", "tisch", "jacht"]) assert.ok(answers.includes(w), w);
  for (const w of ["obama", "donau", "isaak", "hunde", "ärzte"]) assert.ok(!answers.includes(w), w);
});

test("каждая загадка есть среди допустимых слов", () => {
  const set = new Set(guesses);
  assert.ok(answers.every((w) => set.has(w)));
});
