// App tests: they launch the real Electron app (see tests/e2e/helpers.js).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  globalSetup: require.resolve('./tests/fixtures/global-setup.js'),
  workers: 1, // the app allows one running copy at a time
  timeout: 90000,
  expect: { timeout: 10000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
});
