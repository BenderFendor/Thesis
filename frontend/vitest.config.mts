import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tools/oxlint/**/*.test.ts"],
    setupFiles: ["./tools/oxlint/vitest.setup.ts"],
  },
})
