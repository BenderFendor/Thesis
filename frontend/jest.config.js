/** @type {typeof import("next/jest").default} */
const nextJest = require("next/jest");

const createJestConfig = nextJest({
    dir: "./",
  });

/** @type {import("jest").Config} */
const customJestConfig = {
    moduleNameMapper: {
      "^@/(.*)$": "<rootDir>/$1",
    },
    modulePathIgnorePatterns: ["<rootDir>/.next/"],
    setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
    testEnvironment: "jest-environment-jsdom",
    testPathIgnorePatterns: ["<rootDir>/tools/oxlint/"],
    transformIgnorePatterns: [],
  };

module.exports = createJestConfig(customJestConfig);
