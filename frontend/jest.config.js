const nextJest = require("next/jest"),

 createJestConfig = nextJest({
  dir: "./",
}),

 customJestConfig = {
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jest-environment-jsdom",
};

module.exports = createJestConfig(customJestConfig);
