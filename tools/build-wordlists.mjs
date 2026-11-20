import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HunspellReader } from "hunspell-reader";
import { loadModule } from "hunspell-asm";

const require = createRequire(import.meta.url);
const dictionary = dirname(require.resolve("dictionary-de"));
const aff = join(dictionary, "index.aff");
const dic = join(dictionary, "index.dic");
const answerSource = new URL("./answer_words.txt", import.meta.url);
const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const playable = /^[a-zäöüß]{5}$/u;

const reader = await HunspellReader.createFromFiles(aff, dic);
const factory = await loadModule();
const [affBytes, dicBytes] = await Promise.all([readFile(aff), readFile(dic)]);
const spell = factory.create(factory.mountBuffer(affBytes), factory.mountBuffer(dicBytes));

const guesses = new Set();
try {
  // Enumerate candidates, then let Hunspell enforce dictionary flags and case.
  for (const candidate of reader) {
    const normalized = candidate.normalize("NFC");
    const word = normalized.toLowerCase();
    if (playable.test(word) && !guesses.has(word) && spell.spell(normalized)) {
      guesses.add(word);
    }
  }
} finally {
  spell.dispose();
}

const answers = (await readFile(answerSource, "utf8")).split(/\s+/).filter(Boolean);
if (answers.length < 4 || answers.length !== new Set(answers).size) {
  throw new Error("The answer list needs at least four distinct words and no duplicates.");
}
const missing = answers.filter((word) => !guesses.has(word));
if (missing.length) {
  throw new Error("Answers rejected by the guess dictionary: " + missing.join(", "));
}

const files = new Map([
  ["answers.json", answers.sort()],
  ["guesses.json", [...guesses].sort()],
]);

if (process.argv.includes("--check")) {
  for (const [file, words] of files) {
    if ((await readFile(join(dataDir, file), "utf8")) !== JSON.stringify(words)) {
      throw new Error(file + " is stale. Run npm run build-words.");
    }
  }
} else {
  for (const [file, words] of files) {
    await writeFile(join(dataDir, file), JSON.stringify(words));
  }
}
console.log(`answers=${answers.length} guesses=${guesses.size}`);
