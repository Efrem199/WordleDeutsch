const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHTML } = require("linkedom");
const { getExplanation, getWikiImage, parseWiktionary } = require("../js/explain.js");

globalThis.document = parseHTML("<html></html>").document;
const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
});
test.beforeEach(() => storage.clear());

const noun = '<h3 id="Substantiv"><a href="/wiki/Hilfe:Wortart#Substantiv">Substantiv</a>, <em>m</em></h3>';
const german = '<div class="mw-heading mw-heading2"><h2>Wort (<a href="/wiki/Wiktionary:Deutsch">Deutsch</a>)</h2></div>';
const meanings = (items) => '<p>Bedeutungen:</p><dl>' + items.map((text) => '<dd>' + text + '</dd>').join("") + '</dl>';
const article = (...nodes) => '<div class="mw-parser-output">' + nodes.join("") + '</div>';

// Elements reproduced from the rendered Wiktionary article Tisch, CC BY-SA 4.0.
const tisch = article(german, '<div class="mw-heading mw-heading3">' + noun + '</div>', meanings([
  '[1] <i>Möbel&#58;</i> <a href="/wiki/Möbelstück">Möbelstück</a><sup class="reference">[25]</sup>',
  '[2] um einen Tisch <sup>[1]</sup> <a href="/wiki/versammelt">versammelte</a> Gesellschaft',
  '[3] Mahlzeit',
]));

test("Tisch: HTML, Zeichenreferenzen, Fußnoten und Bedeutungsverweise", () => {
  assert.deepEqual(parseWiktionary(tisch), {
    wortart: "Substantiv",
    defs: ["Möbel: Möbelstück", "um einen Tisch Bedeutung 1 versammelte Gesellschaft", "Mahlzeit"],
    lemma: null,
    image: null,
    grammar: null,
    audio: null,
  });
});

test("Nominativ, mehrere Pluralformen und Aussprache aus derselben Substantiv-Sektion", () => {
  const html = article(german, noun, `
    <table class="inflection-table">
      <tr><th></th><th>Singular</th><th>Plural 1</th><th>Plural 2</th></tr>
      <tr><th>Nominativ</th><td>der Atlas</td><td>die Atlanten</td><td>die Atlasse</td></tr>
      <tr><th>Genitiv</th><td>des Atlas</td><td>der Atlanten</td><td>der Atlasse</td></tr>
    </table>
    <dl><dd><a href="/wiki/Hilfe:Hörbeispiele">Hörbeispiele:</a>
      <a href="//upload.wikimedia.org/wikipedia/commons/3/39/De-Atlas.ogg">Anhören</a>
    </dd></dl>`, meanings(["[1] Kartenwerk"]));
  const entry = parseWiktionary(html);
  assert.deepEqual(entry.grammar, { singular: "der Atlas", plurals: ["die Atlanten", "die Atlasse"] });
  assert.deepEqual(entry.audio, {
    url: "https://upload.wikimedia.org/wikipedia/commons/3/39/De-Atlas.ogg",
    page: "https://de.wiktionary.org/wiki/Datei:De-Atlas.ogg",
  });
});

test("Bedeutungen aus anderen Sprachen und Wortarten werden übersprungen", () => {
  const adjective = '<h3><a href="/wiki/Hilfe:Wortart#Adjektiv">Adjektiv</a></h3>';
  const english = '<h2>Wort (<a href="/wiki/Wiktionary:Englisch">Englisch</a>)</h2>';
  assert.deepEqual(parseWiktionary(article(german, adjective, meanings(["[1] egal"]), english, noun,
    meanings(["[1] table"]))).defs, []);
});

test("verschiedene Substantiv-Abschnitte und Linkanker", () => {
  const otherNoun = noun.replace('id="Substantiv"', 'id="Substantiv_2"');
  const html = article(german, noun, meanings(["[1] Kartenwerk"]), otherNoun, meanings(["[1] Gewebe", "[2] Stoff"]));
  assert.deepEqual(parseWiktionary(html).defs, ["Kartenwerk", "Gewebe", "Stoff"]);
  assert.deepEqual(parseWiktionary(html, "Substantiv_2").defs, ["Gewebe", "Stoff"]);
});

test("Gattungsnamen haben Vorrang vor Familiennamen", () => {
  const surname = noun.replace("</h3>", ', <a href="/wiki/Hilfe:Wortart#Nachname">Nachname</a></h3>');
  const html = article(german, surname, meanings(["[1] Familienname"]), noun, meanings(["[1] Mediziner"]));
  assert.deepEqual(parseWiktionary(html).defs, ["Mediziner"]);
});

test("Illustrationen stammen aus dem deutschen Substantiv-Abschnitt", () => {
  const figure = (file, width = 220) => `
    <figure typeof="mw:File/Thumb">
      <a href="/wiki/Datei:${file}.jpg" class="mw-file-description">
        <img src="//thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}.jpg/220px-${file}.jpg" width="${width}">
      </a>
      <figcaption>[1] ein Fisch</figcaption>
    </figure>`;
  const surname = noun.replace("</h3>", ', <a href="/wiki/Hilfe:Wortart#Nachname">Nachname</a></h3>');
  const html = article(figure("OtherLanguage"), german, surname, figure("Map"), noun, figure("Icon", 25),
    "<table><tbody><tr><td>" + figure("Fish") + "</td></tr></tbody></table>", meanings(["[1] Wassertier"]));
  assert.deepEqual(parseWiktionary(html).image, {
    description: "ein Fisch",
    thumb: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Fish.jpg/220px-Fish.jpg",
    full: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fish.jpg",
    page: "https://de.wiktionary.org/wiki/Datei:Fish.jpg",
    source: "Wiktionary",
  });
});

test("Wiktionary: Jacht → Yacht und Ärzte → Arzt", async (t) => {
  const mockPages = {
    Jacht: article(german, noun, '<div class="lemmaverweis"><a href="/wiki/Yacht">Yacht</a></div>'),
    Yacht: article(german, noun, meanings(["[1] Freizeit- oder Sportboot"])),
    Ärzte: article(german, '<h3><a href="/wiki/Hilfe:Wortart#Deklinierte_Form">Deklinierte Form</a></h3>',
      '<div><table class="grundformverweis-dekl"><tr><td><a href="/wiki/Arzt">Arzt</a></td></tr></table></div>'),
    Arzt: article(german, noun, meanings(["[1] Mediziner"])),
  };
  const request = t.mock.method(globalThis, "fetch", async (url) => {
    const page = new URL(url).searchParams.get("page");
    return { ok: true, json: async () => ({ parse: { title: page, text: mockPages[page] } }) };
  });
  for (const [word, lemma, definition] of [["jacht", "Yacht", "Freizeit- oder Sportboot"], ["ärzte", "Arzt", "Mediziner"]]) {
    const explanation = await getExplanation(word);
    assert.equal(explanation.ok, true);
    assert.equal(explanation.word, word);
    assert.equal(explanation.url, "https://de.wiktionary.org/wiki/" + lemma);
    assert.deepEqual(explanation.defs, [definition]);
  }
  assert.equal(request.mock.callCount(), 4);
});

test("zirkuläre Lemmaverweise enden ohne Wiederholungen", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (url) => {
    const page = new URL(url).searchParams.get("page");
    const other = page === "Jacht" ? "Yacht" : "Jacht";
    return { ok: true, json: async () => ({ parse: { title: page,
      text: article(german, noun, `<div class="lemmaverweis"><a href="/wiki/${other}">${other}</a></div>`),
    } }) };
  });
  assert.equal((await getExplanation("jacht")).ok, false);
  assert.equal(request.mock.callCount(), 2);
});

test("ein API-Ausfall wird nicht als fehlendes Bild gespeichert", async (t) => {
  const image = "https://upload.wikimedia.org/wikipedia/commons/f/f0/example.jpg";
  let summaryAvailable = false;
  const request = t.mock.method(globalThis, "fetch", async (url) => {
    if (new URL(url).pathname === "/w/api.php" || !summaryAvailable) {
      return { ok: false, status: 429 };
    }
    return { ok: true, json: async () => ({ thumbnail: { source: image } }) };
  });
  assert.equal(await getWikiImage("katze"), null);
  summaryAvailable = true;
  assert.equal((await getWikiImage("katze")).thumb, image);
  assert.equal((await getWikiImage("katze")).thumb, image);
  assert.equal(request.mock.callCount(), 4);
});

test("Bilder von Begriffsklärungen erscheinen nicht", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ query: { pages: [{
      pageprops: { disambiguation: "" }, thumbnail: { source: "https://thumb.wikimedia.org/example.jpg" },
    }] } }),
  }));
  assert.equal(await getWikiImage("fisch"), null);
  assert.equal(request.mock.callCount(), 1);
});
