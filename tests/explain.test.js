const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWiktionary } = require("../public/js/explain.js");

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
