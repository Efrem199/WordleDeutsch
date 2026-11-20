const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWiktionary } = require("../js/explain.js");

const SAMPLE = `{{Siehe auch|[[tisch]]}}
== Tisch ({{Sprache|Deutsch}}) ==
=== {{Wortart|Substantiv|Deutsch}}, {{m}} ===

{{Bedeutungen}}
:[1] {{K|Möbel}} [[Möbelstück]], das aus einer [[Platte]] mit vier oder drei [[Bein]]en besteht
:[2] um einen Tisch [1] [[versammelt]]e [[Gesellschaft]]
:[3] [[Mahlzeit]]

{{Herkunft}}
:von [[mittelhochdeutsch]] ''{{Ü|gmh|tisch}},''
`;

test("parseWiktionary: Wortart und Bedeutungen", () => {
  const r = parseWiktionary(SAMPLE);
  assert.equal(r.wortart, "Substantiv");
  assert.equal(r.defs.length, 3);
  assert.equal(r.defs[0], "(Möbel) Möbelstück, das aus einer Platte mit vier oder drei Beinen besteht");
  assert.equal(r.defs[1], "um einen Tisch versammelte Gesellschaft");
  assert.equal(r.defs[2], "Mahlzeit");
});

test("parseWiktionary: ohne deutsche Sektion -> leer", () => {
  const r = parseWiktionary("== Tisch ({{Sprache|Englisch}}) ==\n{{Bedeutungen}}\n:[1] table\n");
  assert.deepEqual(r.defs, []);
});

const { findLemma } = require("../js/explain.js");

// Фрагмент реальной статьи «Wurst» (de.wiktionary.org)
const WURST = `== Wurst ({{Sprache|Deutsch}}) ==
=== {{Wortart|Substantiv|Deutsch}}, {{f}} ===

{{Bedeutungen}}
:[1] {{K|Gastronomie}} längliches [[Fleischprodukt]]; meist eine [[Paste]] aus [[Tierfleisch]] in einen [[Tierdarm]] [[pressen|gepresst]]
:[2] {{K|Gastronomie}} [[Aufschnitt]] aus [[Fleisch]]
:[3] {{K|ugs.|übertragen}} [[länglich]]er, [[wurstförmig]]er [[Gegenstand]]

{{Gegenwörter}}
:[1] [[Schinken]], [[Sülze]]
`;

// Прилагательное «wurst» (egal) — в Wortart-секции, которая не должна попадать в пояснение
const WURST_ADJ = `== wurst ({{Sprache|Deutsch}}) ==
=== {{Wortart|Adjektiv|Deutsch}} ===

{{Bedeutungen}}
:[1] [[egal]], [[gleichgültig]]
`;

// Статья «Jacht» — только отсылка на «Yacht»
const JACHT = `== Jacht ({{Sprache|Deutsch}}) ==
=== {{Wortart|Substantiv|Deutsch}}, {{f}} ===

{{Alternative Schreibweisen}}
:[[Yacht]]

{{Lemmaverweis|Yacht}}

{{Referenzen}}
`;

test("Wurst: Substantiv-Sektion, {{K|a|b}} und Verweise", () => {
  const r = parseWiktionary(WURST);
  assert.equal(r.wortart, "Substantiv");
  assert.deepEqual(r.defs, [
    "(Gastronomie) längliches Fleischprodukt; meist eine Paste aus Tierfleisch in einen Tierdarm gepresst",
    "(Gastronomie) Aufschnitt aus Fleisch",
    "(ugs., übertragen) länglicher, wurstförmiger Gegenstand",
  ]);
});

test("Nur Adjektiv vorhanden -> keine Bedeutung (Wurst darf nicht zu «egal» werden)", () => {
  const r = parseWiktionary(WURST_ADJ);
  assert.deepEqual(r.defs, []);
  assert.equal(r.wortart, "");
});

test("Jacht: keine eigenen Bedeutungen, Verweis auf Yacht", () => {
  assert.deepEqual(parseWiktionary(JACHT).defs, []);
  assert.equal(findLemma(JACHT), "Yacht");
});
