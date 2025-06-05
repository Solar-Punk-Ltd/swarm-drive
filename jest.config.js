module.exports = {
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",

      testMatch: ["<rootDir>/tests/unit/**/*.spec.ts"],

      transformIgnorePatterns: ["/node_modules/"],
    },
    {
      displayName: "integration",
      preset: "ts-jest",
      testEnvironment: "node",

      testMatch: ["<rootDir>/tests/integration/**/*.spec.ts"],

      globalSetup: "<rootDir>/tests/integration/test-node-setup/jestSetup.ts",
      globalTeardown: "<rootDir>/tests/integration/test-node-setup/jestTeardown.ts",

      transformIgnorePatterns: ["/node_modules/"],
    },
  ],
};
