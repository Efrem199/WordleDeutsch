const { test, expect } = require("@playwright/test");

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
  await page.locator("summary").click();
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
  await page.locator("summary").click();
  await expect(page.getByText("Wörter: TISCH (Versuch 1)")).toBeVisible();
  await page.getByRole("button", { name: "Bedeutungen anzeigen" }).click();
  await expect(page.locator(".explain li")).toBeVisible();
  await page.locator("summary").click();
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
