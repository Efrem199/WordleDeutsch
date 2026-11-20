const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests/browser",
  use: {
    baseURL: "http://localhost:8000",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: "npm start",
    url: "http://localhost:8000",
  },
});
