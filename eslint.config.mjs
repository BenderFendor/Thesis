import frontendConfig from "./frontend/eslint.config.mjs";

const rootConfig = frontendConfig.map((entry) => ({
  ...entry,
  settings: {
    ...(entry.settings ?? {}),
    next: {
      ...(typeof entry.settings?.next === "object" && entry.settings?.next !== null
        ? entry.settings.next
        : {}),
      rootDir: "./frontend",
    },
  },
}));

export default rootConfig;
