const test = require("node:test");
const assert = require("node:assert/strict");
const guesses = require("../data/guesses.json");
const answers = require("../data/answers.json");

test("допустимые слова: 5 букв, нижний регистр, ß поддерживается", () => {
  assert.ok(guesses.every((w) => /^[a-zäöüß]{5}$/.test(w)));
});

test("регрессия: обычные слова из словаря принимаются", () => {
  const set = new Set(guesses);
  for (const w of ["katze", "tisch", "hunde", "wurst", "essen", "schön"]) {
    assert.ok(set.has(w), w);
  }
});

test("каждая загадка есть среди допустимых слов", () => {
  const set = new Set(guesses);
  assert.ok(answers.every((w) => set.has(w)));
});
