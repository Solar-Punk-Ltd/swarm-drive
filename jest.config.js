module.exports = {
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",

      testMatch: ["<rootDir>/tests/unit/**/*.spec.ts"],

      transformIgnorePatterns: ["/node_modules/"],
    },
  ],
};
