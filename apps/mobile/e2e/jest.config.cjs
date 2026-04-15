module.exports = {
  globalSetup: "detox/runners/jest/globalSetup",
  globalTeardown: "detox/runners/jest/globalTeardown",
  reporters: ["detox/runners/jest/reporter"],
  rootDir: "..",
  testEnvironment: "detox/runners/jest/testEnvironment",
  testMatch: ["<rootDir>/e2e/**/*.e2e.js"],
  testTimeout: 120000,
  verbose: true,
};
