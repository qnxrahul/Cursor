// Karma configuration for Angular project using Puppeteer Chrome
// Ensures headless testing without requiring system Chrome

module.exports = function (config) {
  // Set Chrome binary from Puppeteer to avoid missing CHROME_BIN
  try {
    process.env.CHROME_BIN = require('puppeteer').executablePath();
  } catch (_) {
    // Puppeteer not available; fall back to system Chrome if present
  }

  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {},
      clearContext: false,
    },
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    singleRun: true,
    reporters: ['progress'],
  });
};

