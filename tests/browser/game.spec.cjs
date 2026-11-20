const { test, expect } = require("@playwright/test");
const L = require("../../js/logic.js");

const storageKey = "wordle-deutsch-v1";
const quorum = ["apfel", "fisch", "stuhl", "tiger"];
const words = { wordle: "Wordle", quordle: "Quordle" };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");

function play(page, mode) {
  return page.locator(".mode-card").filter({ hasText: words[mode] }).click();
}

function save(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
}

function seedFinishedWordle(page, word) {
  return page.addInitScript(({ key, word }) => {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({
      version: 1, used: [word], games: [{
        id: "finished", mode: "wordle", status: "won", startedAt: new Date().toISOString(),
        maxAttempts: 6, answers: [word], solvedAt: [1], guesses: [], progress: [],
      }],
    }));
  }, { key: storageKey, word });
}

async function guess(page, word) {
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}

function installExternalFixtures(context) {
  return context.route(/https:\/\/de\.(wiktionary|wikipedia)\.org\//, (route) => route.fulfill({
    json: {
      parse: { title: "Tisch", text: `
        <div class="mw-parser-output">
          <h2>Tisch (<a href="/wiki/Wiktionary:Deutsch">Deutsch</a>)</h2>
          <h3><a href="/wiki/Hilfe:Wortart#Substantiv">Substantiv</a></h3>
          <p>Bedeutungen:</p><dl><dd>[1] Möbelstück</dd></dl>
        </div>` },
    },
  }));
}

test("loading the dictionary cannot create an invalid game through navigation", async ({ page }) => {
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  await page.route("**/data/*.json", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Regeln", exact: true }).click();
  await page.getByRole("link", { name: "Zum Menü" }).click();
  await expect(page.getByText("Wörterbuch wird geladen")).toBeVisible();
  await expect(page.locator(".mode-card")).toHaveCount(0);
  expect(await save(page)).toBeNull();
  unblock();
  await play(page, "wordle");
  await expect(page.getByText("Versuch 1 von 6")).toBeVisible();
  expect((await save(page)).games[0].answers[0]).toMatch(/^[a-zäöüß]{5}$/);
});

test("the daily puzzle matches across profiles and resumes alongside free play", async ({ browser, context, page }) => {
  await installExternalFixtures(context);
  const date = new Date("2026-11-21T12:00:00Z");
  await page.clock.setFixedTime(date);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text) => { window.copied = text; } } });
  });
  const openDaily = (target) => target.locator(".daily-card").filter({ hasText: "Wordle" }).click();
  const goMenu = (target) => target.locator('.play-bar a[href="#menu"]').click();

  await page.goto("/");
  await openDaily(page);
  await expect(page.getByText("Versuch 1 von 6")).toBeVisible();
  const daily = (await save(page)).games[0];
  expect(daily.answers).toEqual(["dunst"]);
  expect(daily.dailyDate).toBe("2026-11-21");
  await guess(page, "tisch");
  await expect(page.getByText("Versuch 2 von 6")).toBeVisible();

  await goMenu(page);
  await play(page, "wordle");
  await expect(page.getByText("Versuch 1 von 6")).toBeVisible();
  const twoGames = await save(page);
  expect(twoGames.games.map((game) => game.status)).toEqual(["playing", "playing"]);
  expect(twoGames.used).toHaveLength(1);
  await goMenu(page);
  await openDaily(page);
  await expect(page.getByText("Versuch 2 von 6")).toBeVisible();
  await guess(page, "dunst");
  await expect(page.getByRole("heading", { name: "Geschafft!" })).toBeVisible();
  await page.getByRole("button", { name: "Ergebnis kopieren" }).click();
  await expect.poll(() => page.evaluate(() => window.copied)).toContain("🟩🟩🟩🟩🟩");
  expect(await page.evaluate(() => window.copied)).not.toMatch(/dunst|tisch/i);
  await goMenu(page);
  await openDaily(page);
  await expect(page.getByRole("heading", { name: "Geschafft!" })).toBeVisible();
  expect((await save(page)).games).toHaveLength(2);

  const another = await browser.newContext({ baseURL: page.url() });
  try {
    const visitor = await another.newPage();
    await visitor.clock.setFixedTime(date);
    await visitor.goto("/");
    await openDaily(visitor);
    await expect(visitor.getByText("Versuch 1 von 6")).toBeVisible();
    expect((await save(visitor)).games[0].answers).toEqual(daily.answers);
  } finally {
    await another.close();
  }
});

test("on a wide screen Wordle uses larger tiles and keeps the keyboard under the board", async ({ page }) => {
  await page.setViewportSize({ width: 1900, height: 945 });
  await page.goto("/");
  await play(page, "wordle");
  const tile = await page.locator(".board .tile").first().boundingBox();
  expect(tile.width).toBeGreaterThanOrEqual(70);
  const board = await page.locator(".board").boundingBox();
  const keyboard = await page.locator("#keyboard").boundingBox();
  const gap = keyboard.y - (board.y + board.height);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(30);
  expect(keyboard.y + keyboard.height).toBeLessThanOrEqual(945);
});

test("Quordle keys show four independent results and mobile shows the selected board", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/data/answers.json", (route) => route.fulfill({ json: quorum }));
  await page.goto("/");
  await play(page, "quordle");
  await expect(page.locator(".board:visible")).toHaveCount(4);
  await expect(page.locator(".play-pick")).toBeHidden();
  const keyboard = await page.locator("#keyboard").boundingBox();
  const playArea = await page.locator(".play-scroll").boundingBox();
  expect(keyboard.y + keyboard.height).toBeLessThanOrEqual(720);
  for (const board of await page.locator(".board").all()) {
    const box = await board.boundingBox();
    const bottom = box.y + box.height;
    expect(bottom).toBeLessThanOrEqual(playArea.y + playArea.height + 1);
    expect(keyboard.y - bottom).toBeGreaterThanOrEqual(0);
    expect(keyboard.y - bottom).toBeLessThan(30);
  }
  await guess(page, "tisch");
  await expect(page.getByText("Versuch 2 von 9")).toBeVisible();
  const answers = (await save(page)).games[0].answers;
  await expect(page.locator('[data-key="t"] .key-sectors i')).toHaveClass(
    answers.map((word) => L.evaluateGuess("tisch", word)[0]));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".board:visible")).toHaveCount(1);
  await expect(page.locator(".play-pick")).toBeVisible();
  await page.getByRole("button", { name: "Alle vier Wörter anzeigen" }).click();
  await expect(page.locator(".board:visible")).toHaveCount(4);
  await expect(page.locator(".board-hint i[class]").first()).toBeVisible();
  await page.locator('.play-pick [data-board-pick="2"]').click();
  await expect(page.locator('[data-board="2"]')).toBeVisible();
  await expect(page.locator('[data-board="0"]')).toBeHidden();
  await expect(page.getByRole("button", { name: "Alle vier Wörter anzeigen" })).toHaveAttribute("aria-pressed", "false");
  await guess(page, "lerne");
  await expect(page.getByText("Versuch 3 von 9")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 568 });
  const shortViewport = await page.locator(".play-scroll").boundingBox();
  const selected = await page.locator('[data-board="2"]').boundingBox();
  expect(selected.y + selected.height).toBeLessThanOrEqual(shortViewport.y + shortViewport.height + 1);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator(".play-pick")).toBeHidden();
  await expect(page.locator(".board:visible")).toHaveCount(4);
});

test("free play works when the daily word list is unavailable", async ({ page }) => {
  await page.route("**/data/daily-words.json", (route) => route.fulfill({ status: 503 }));
  await page.goto("/");
  await expect(page.locator(".daily-card").first()).toBeDisabled();
  await expect(page.getByText("Das Tagesrätsel konnte nicht geladen werden.")).toBeVisible();
  await play(page, "wordle");
  await expect(page.getByText("Versuch 1 von 6")).toBeVisible();
});

test("on a phone, free play stays above the daily choices and navigation stays at the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Freies Spiel" })).toBeVisible();
  const free = await page.locator(".free-panel").boundingBox();
  const daily = await page.locator(".daily-panel").boundingBox();
  const nav = await page.locator(".topnav").boundingBox();
  expect(free.y + free.height).toBeLessThan(daily.y);
  expect(nav.y + nav.height).toBeCloseTo(844, 0);
});

test("floating background letters respect reduced motion and never capture clicks", async ({ page }) => {
  await page.goto("/");
  const background = page.locator(".bg-letters");
  const letters = background.locator("span");
  await expect(background).toHaveAttribute("aria-hidden", "true");
  await expect(background).toHaveCSS("pointer-events", "none");
  await expect(letters).toHaveCount(16);
  await expect(letters.first()).toHaveCSS("animation-name", "drift-letter");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(letters.first()).toHaveCSS("animation-name", "none");
  await play(page, "wordle");
  await expect(page.getByText("Versuch 1 von 6")).toBeVisible();
});

test("the menu animates WORDLE on entry, including when daily puzzles load slowly", async ({ page }) => {
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  await page.route("**/data/daily-words.json", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const tiles = page.locator(".hero-tiles span");
  await expect(tiles).toHaveCount(6);
  await expect(tiles.first()).toHaveCSS("animation-name", "enter-letter");
  await expect(tiles.last()).toHaveCSS("animation-delay", "0.275s");
  unblock();
  await expect(page.locator(".daily-card").first()).toBeEnabled();
  await expect(tiles.first()).toHaveCSS("animation-name", "enter-letter");

  await play(page, "wordle");
  await page.locator('.play-bar a[href="#menu"]').click();
  await expect(tiles.first()).toHaveCSS("animation-name", "enter-letter");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(tiles.first()).toHaveCSS("animation-name", "none");
});

test("the daily label distinguishes the Berlin date from the user's next reset time", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, timezoneId: "Europe/Moscow" });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-11-20T21:47:57Z"));
    await page.goto("/");
    await expect(page.locator(".daily-panel .section-head time")).toHaveText("20. November · Berlin");
    const reset = page.locator(".daily-reset time");
    await expect(reset).toHaveAttribute("datetime", "2026-11-20T23:00:00.000Z");
    await expect(reset).toContainText("02:00");
  } finally {
    await context.close();
  }
});

test("a small touch screen can reach the centered footer, play, and open a replay", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, isMobile: true, hasTouch: true, viewport: { width: 320, height: 568 },
  });
  try {
    await installExternalFixtures(context);
    const page = await context.newPage();
    await page.route("**/data/answers.json", (route) => route.fulfill({
      json: ["tisch", "fisch", "stuhl", "tiger"],
    }));
    await page.addInitScript(() => {
      const get = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = (view) => {
        if (!(view instanceof Uint32Array)) return get(view);
        view[0] = 0;
        return view;
      };
    });
    await page.goto("/");
    await expect(page.locator(".daily-card").first()).toBeEnabled();
    const footer = page.locator(".footer");
    await expect(footer).toHaveCSS("justify-content", "center");
    await expect(footer).toHaveCSS("text-align", "center");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const nav = await page.locator(".topnav").boundingBox();
    for (const link of await footer.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThan(nav.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

    await page.locator(".mode-card").filter({ hasText: "Wordle" }).tap();
    await expect(page.getByText("Versuch 1 von 6")).toBeVisible();
    for (const letter of "tisch") await page.locator(`[data-key="${letter}"]`).tap();
    await page.locator('[data-key="Enter"]').tap();
    await expect(page.getByRole("heading", { name: "Geschafft!" })).toBeVisible();
    await page.getByRole("button", { name: "Merken", exact: true }).tap();
    await page.locator('.topnav a[href="#vocab"]').tap();
    await expect(page.locator(".vocab-entry summary")).toHaveText("Tisch");
    await page.locator('.topnav a[href="#stats"]').tap();
    await page.locator(".history-entry summary").tap();
    await expect(page.locator(".replay-answer")).toHaveText("TISCH");
    await expect(page.locator(".replay-grid .tile.correct")).toHaveCount(5);
  } finally {
    await context.close();
  }
});

test("word cards show grammar, play the recording, and remember the word after reload", async ({ page }) => {
  const audio = "https://upload.wikimedia.org/wikipedia/commons/e/e9/De-Tisch.ogg";
  await seedFinishedWordle(page, "tisch");
  await page.addInitScript(() => {
    window.Audio = class {
      constructor(url) { this.url = url; }
      pause() {}
      play() { window.audioPlayed = this.url; return Promise.resolve(); }
    };
  });
  await page.route("https://de.wikipedia.org/**", (route) => route.fulfill({ json: { query: { pages: [{ missing: true }] } } }));
  await page.route("https://de.wiktionary.org/w/api.php?**", (route) => route.fulfill({
    json: { parse: { title: "Tisch", text: `
      <div class="mw-parser-output">
        <h2>Tisch (<a href="/wiki/Wiktionary:Deutsch">Deutsch</a>)</h2>
        <h3><a href="/wiki/Hilfe:Wortart#Substantiv">Substantiv</a></h3>
        <table class="inflection-table"><tr><th></th><th>Singular</th><th>Plural</th></tr>
          <tr><th>Nominativ</th><td>der Tisch</td><td>die Tische</td></tr></table>
        <dl><dd><a href="/wiki/Hilfe:Hörbeispiele">Hörbeispiele:</a><a href="${audio}">Audio</a></dd></dl>
        <p>Bedeutungen:</p><dl><dd>[1] Möbelstück</dd></dl>
      </div>` } },
  }));
  await page.goto("/#play");
  await expect(page.getByRole("heading", { name: "der Tisch" })).toBeVisible();
  await expect(page.getByText("Plural: die Tische")).toBeVisible();
  await page.getByRole("button", { name: "der Tisch anhören" }).click();
  expect(await page.evaluate(() => window.audioPlayed)).toBe(audio);
  await page.getByRole("button", { name: "Merken", exact: true }).click();
  await expect(page.getByRole("button", { name: "Gemerkt" })).toHaveAttribute("aria-pressed", "true");
  await page.locator('.topnav a[href="#vocab"]').click();
  await page.reload();
  await page.locator(".vocab-entry summary").click();
  await expect(page.getByRole("heading", { name: "der Tisch" })).toBeVisible();
  expect((await save(page)).savedWords).toEqual(["tisch"]);
  await page.getByRole("button", { name: "Gemerkt" }).click();
  await expect(page.locator(".vocab-entry")).toHaveCount(0);
});

test("a legacy completed Quordle can be replayed by attempt and by board", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  const answers = ["apfel", "tisch", "stuhl", "tiger"];
  const solvedAt = [2, 1, null, null];
  const guesses = ["tisch", "apfel", "lerne"].map((word, index) => ({
    word, results: answers.map((answer, board) => {
      return solvedAt[board] !== null && index >= solvedAt[board] ? null : L.evaluateGuess(word, answer);
    }),
  }));
  await page.addInitScript(({ key, answers, solvedAt, guesses }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, used: answers, games: [{
      id: "past", mode: "quordle", status: "lost", startedAt: new Date().toISOString(),
      maxAttempts: 9, answers, solvedAt, guesses, progress: [],
    }] }));
  }, { key: storageKey, answers, solvedAt, guesses });
  await page.goto("/#stats");
  const history = await page.locator(".history-panel").boundingBox();
  const stats = await page.locator(".history-dashboard").boundingBox();
  expect(history.y).toBeCloseTo(stats.y);
  expect(history.x + history.width).toBeLessThan(stats.x);
  await page.locator(".history-entry summary").click();
  await expect(page.locator(".replay-answer")).toHaveText("APFEL");
  await expect(page.locator(".replay-pick")).toBeVisible();
  await expect(page.locator(".replay-grid .row")).toHaveCount(2);
  await page.getByRole("button", { name: "‹ Zurück" }).click();
  await expect(page.locator(".replay-grid .row")).toHaveCount(1);
  await page.locator('.replay-pick [data-board-pick="2"]').click();
  await expect(page.locator(".replay-answer")).toHaveText("STUHL");
  await expect(page.locator(".replay-grid .row")).toHaveCount(3);
  await expect(page.locator(".replay-grid .tile.present").first()).toBeVisible();
});

test("vocabulary examples can be saved and hide a solution from an active game", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installExternalFixtures(context);
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, used: ["katze"], games: [{
      id: "active", mode: "wordle", status: "playing", startedAt: new Date().toISOString(),
      maxAttempts: 6, answers: ["katze"], solvedAt: [null], guesses: [], progress: [],
    }] }));
  }, storageKey);
  await page.goto("/#vocab");
  const suggestions = page.locator(".discovery-entry summary");
  await expect(suggestions).toHaveText(["Tisch", "Blume", "Wolke"]);
  await expect(page.locator(".discovery-entry[open]")).toHaveCount(0);
  const savedPanel = await page.locator(".saved-panel").boundingBox();
  const discoverPanel = await page.locator(".discover-panel").boundingBox();
  expect(savedPanel.y + savedPanel.height).toBeLessThan(discoverPanel.y);

  await suggestions.filter({ hasText: "Tisch" }).click();
  await expect(page.getByText("Möbelstück")).toBeVisible();
  await page.getByRole("button", { name: "Merken", exact: true }).click();
  await expect(page.locator(".vocab-entry summary")).toHaveText("Tisch");
  await expect(suggestions).toHaveText(["Blume", "Wolke", "Fisch"]);
});

test("invalid word lists leave the game unavailable but keep rules and history accessible", async ({ page }) => {
  await page.route("**/data/answers.json", (route) => route.fulfill({ json: [] }));
  await page.goto("/#play");
  await expect(page.getByText("Die Wortliste konnte nicht geladen werden.", { exact: false })).toBeVisible();
  await page.locator('.topnav a[href="#stats"]').click();
  await expect(page.getByRole("heading", { name: "Verlauf & Statistik" })).toBeVisible();
  expect(await save(page)).toBeNull();
});

test("Quordle resumes after reload and its history hides the solutions while playing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/data/answers.json", (route) => route.fulfill({ json: quorum }));
  await page.goto("/");
  await play(page, "quordle");
  await expect(page.locator(".board")).toHaveCount(4);
  await guess(page, "lerne");
  await expect(page.getByText("Versuch 2 von 9")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Versuch 2 von 9")).toBeVisible();

  await page.locator('.play-bar a[href="#menu"]').click();
  await page.locator('.topnav a[href="#stats"]').click();
  await page.locator(".history-entry summary").click();
  await expect(page.getByText("Versuch 1: 0 von 4 Wörtern gelöst", { exact: false })).toBeVisible();
  await expect(page.getByText(/^Wörter:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bedeutungen anzeigen" })).toHaveCount(0);
  for (const word of quorum) await expect(page.getByText(word, { exact: false })).toHaveCount(0);
});

test("concurrent guesses from two tabs both survive", async ({ context, page }) => {
  await context.route("**/data/answers.json", (route) => route.fulfill({ json: quorum }));
  await page.goto("/");
  await play(page, "quordle");
  await expect(page.getByText("Versuch 1 von 9")).toBeVisible();
  const second = await context.newPage();
  await second.goto("/#play");
  await expect(second.getByText("Versuch 1 von 9")).toBeVisible();

  await Promise.all([page.keyboard.type("tisch"), second.keyboard.type("wurst")]);
  await Promise.all([page.keyboard.press("Enter"), second.keyboard.press("Enter")]);
  await expect(page.getByText("Versuch 3 von 9")).toBeVisible();
  await expect(second.getByText("Versuch 3 von 9")).toBeVisible();
  const attempts = (await save(second)).games[0].guesses.map((guess) => guess.word);
  expect(attempts.sort()).toEqual(["tisch", "wurst"]);
});

test("a corrupt game is skipped and an old valid game can still be won", async ({ context, page }) => {
  await installExternalFixtures(context);
  await page.addInitScript((key) => {
    if (localStorage.getItem(key)) return;
    const game = {
      mode: "wordle", status: "playing", maxAttempts: 6, startedAt: new Date().toISOString(),
      guesses: [], progress: [], solvedAt: [null],
    };
    localStorage.setItem(key, JSON.stringify({
      version: 1, used: [null, "tauch"], games: [
        { ...game, id: "broken", answers: [null] },
        { ...game, id: "old", answers: ["tauch"] },
      ],
    }));
  }, storageKey);
  await page.goto("/#play");
  await expect(page.getByText("Versuch 1 von 6")).toBeVisible();
  await guess(page, "tauch");
  await expect(page.getByRole("heading", { name: "Geschafft!" })).toBeVisible();
  const stored = await save(page);
  expect(stored.games.map(({ id, status }) => [id, status])).toEqual([["old", "won"]]);
  expect(stored.used).toEqual(["tauch"]);
});

test("definitions appear independently of images and are available in finished history", async ({ context, page }) => {
  await installExternalFixtures(context);
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  await page.route("https://de.wikipedia.org/**", async (route) => {
    await gate;
    await route.fulfill({ status: 404 });
  });
  await page.route("**/data/answers.json", (route) => route.fulfill({
    json: ["apfel", "fisch", "stuhl", "tisch"],
  }));
  await page.addInitScript(() => {
    const get = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (view) => {
      if (!(view instanceof Uint32Array)) return get(view);
      view[0] = 3;
      return view;
    };
  });
  await page.goto("/");
  await play(page, "wordle");
  await expect(page.getByText("Versuch 1 von 6")).toBeVisible();
  await guess(page, "tisch");
  await expect(page.locator(".explain li")).toHaveText("Möbelstück", { timeout: 4000 });

  await page.locator('.topnav a[href="#stats"]').click();
  await page.locator(".history-entry summary").click();
  await expect(page.getByText("Wörter: TISCH (Versuch 1)")).toBeVisible();
  await page.getByRole("button", { name: "Bedeutungen anzeigen" }).click();
  await expect(page.locator(".explain li")).toBeVisible();
  await page.locator(".history-entry summary").click();
  await expect(page.locator(".explain li")).toBeHidden();
  unblock();
});

test("a previously missing image loads from Wikimedia even when the thumbnail host fails", async ({ context, page }) => {
  await installExternalFixtures(context);
  const thumbPath = "/wikipedia/commons/thumb/5/54/sailboat.jpg/330px-sailboat.jpg";
  const fullPath = "/wikipedia/commons/5/54/sailboat.jpg";
  const thumb = "https://thumb.wikimedia.org" + thumbPath;
  const full = "https://upload.wikimedia.org" + fullPath;
  const article = "https://de.wikipedia.org/wiki/Yacht";
  const unavailable = "https://upload.wikimedia.org/wikipedia/commons/5/54/unavailable.jpg";
  await page.route("https://de.wiktionary.org/w/api.php?**", (route) => route.fulfill({
    json: { parse: { title: "Jacht", text: `
      <div class="mw-parser-output">
        <h2>Jacht (<a href="/wiki/Wiktionary:Deutsch">Deutsch</a>)</h2>
        <h3><a href="/wiki/Hilfe:Wortart#Substantiv">Substantiv</a></h3>
        <figure><a class="mw-file-description" href="/wiki/Datei:unavailable.jpg"><img src="${unavailable}" width="220"></a></figure>
        <p>Bedeutungen:</p><dl><dd>[1] Segelboot</dd></dl>
      </div>` } },
  }));
  await page.route("https://de.wikipedia.org/w/api.php?**", (route) => {
    const title = new URL(route.request().url()).searchParams.get("titles");
    expect(title).toBe("Jacht");
    return route.fulfill({ json: { query: { pages: [{
      title: "Yacht", fullurl: article, description: "Segelboot",
      thumbnail: { source: thumb }, original: { source: full },
    }] } } });
  });
  await page.route(thumb, (route) => route.abort("failed"));
  await page.route("https://upload.wikimedia.org/**", (route) => route.fulfill({
    contentType: "image/png", body: pixel,
  }));
  await page.route(unavailable, (route) => route.abort("failed"));
  await seedFinishedWordle(page, "jacht");
  await page.addInitScript(() => {
    localStorage.setItem("wordle-deutsch-images-v2", '{"jacht":null}');
  });
  await page.goto("/#play");
  await page.locator(".explain").scrollIntoViewIfNeeded();
  await expect(page.locator(".ex-fig a")).toHaveAttribute("href", article);
  const thumbnail = page.getByRole("img", { name: "Jacht" });
  await thumbnail.scrollIntoViewIfNeeded();
  await expect(thumbnail).toHaveAttribute("src", "https://upload.wikimedia.org" + thumbPath);
  await expect(thumbnail).toHaveJSProperty("naturalWidth", 1);

  await page.getByRole("button", { name: "Bild vergrößern" }).click();
  const enlarged = page.getByRole("dialog").getByRole("img");
  await expect(enlarged).toHaveAttribute("src", full);
  await expect(enlarged).toHaveJSProperty("naturalWidth", 1);
});

test("an article illustration needs no Wikipedia request", async ({ page }) => {
  const asset = "https://upload.wikimedia.org/wikipedia/commons/a/ab/fish.png";
  const file = "/wiki/Datei:fish.png";
  const wikipediaRequests = [];
  await page.route("https://de.wikipedia.org/**", (route) => {
    wikipediaRequests.push(route.request().url());
    return route.abort("failed");
  });
  await page.route("https://de.wiktionary.org/w/api.php?**", (route) => route.fulfill({
    json: { parse: { title: "Fisch", text: `
      <div class="mw-parser-output">
        <h2>Fisch (<a href="/wiki/Wiktionary:Deutsch">Deutsch</a>)</h2>
        <h3><a href="/wiki/Hilfe:Wortart#Substantiv">Substantiv</a></h3>
        <figure><a class="mw-file-description" href="${file}"><img src="${asset}" width="220"></a>
          <figcaption>[1] ein Fisch</figcaption></figure>
        <p>Bedeutungen:</p><dl><dd>[1] Wassertier</dd></dl>
      </div>` } },
  }));
  await page.route(asset, (route) => route.fulfill({ contentType: "image/png", body: pixel }));
  await seedFinishedWordle(page, "fisch");
  await page.goto("/#play");
  const picture = page.getByRole("img", { name: "Fisch" });
  await picture.scrollIntoViewIfNeeded();
  await expect(picture).toHaveJSProperty("naturalWidth", 1);
  await expect(page.locator(".ex-fig a")).toHaveAttribute("href", "https://de.wiktionary.org" + file);
  await expect(page.locator(".explain li")).toHaveText("Wassertier");
  expect(wikipediaRequests).toEqual([]);
});

test("a storage write failure still lets the player play and navigate", async ({ page }) => {
  await page.addInitScript((key) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Storage full", "QuotaExceededError");
      return setItem.call(this, name, value);
    };
  }, storageKey);
  await page.route("**/data/answers.json", (route) => route.fulfill({ json: quorum }));
  await page.goto("/");
  await play(page, "wordle");
  await expect(page.getByText("Der Spielstand kann in diesem Browser nicht gespeichert werden.")).toBeVisible();
  await guess(page, "lerne");
  await expect(page.getByText("Versuch 2 von 6")).toBeVisible();
  await page.locator('.play-bar a[href="#menu"]').click();
  await page.getByRole("link", { name: "Laufendes Spiel fortsetzen" }).click();
  await expect(page.getByText("Versuch 2 von 6")).toBeVisible();
  expect(await save(page)).toBeNull();
});
