import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_RANGES,
  APPEARANCE_STORAGE_KEY,
  applyAppearanceSettings,
  buildAppearanceBootstrapScript,
  getServerAppearanceSettings,
  loadAppearanceSettings,
  normalizeAppearanceSettings,
  resetAppearanceSettings,
  saveAppearanceSettings,
  subscribeToAppearanceSettings,
} from "@/lib/appearance-settings";
import { STORAGE_KEYS } from "@/lib/storage";

describe("normalizeAppearanceSettings", () => {
  it("returns untouched defaults for null, junk, or wrong versions", () => {  expect.hasAssertions();

    expect(normalizeAppearanceSettings(null)).toStrictEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearanceSettings("nope")).toStrictEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearanceSettings({ version: 99 })).toStrictEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearanceSettings({})).toStrictEqual(APPEARANCE_DEFAULTS);
  });

  it("keeps valid values and drops unknown keys", () => {  expect.hasAssertions();

    const normalized = normalizeAppearanceSettings({
      colors: { accent: "#ff0000" },
      hackerField: "drop me",
      typography: { textScale: 1.15 },
      version: 1,
    });

    expect(normalized.colors.accent).toBe("#ff0000");
    expect(normalized.colors.background).toBe(APPEARANCE_DEFAULTS.colors.background);
    expect(normalized.typography.textScale).toBeCloseTo(1.15);
    expect(normalized).not.toHaveProperty("hackerField");
  });

  it("clamps numbers into the documented ranges", () => {  expect.hasAssertions();

    const normalized = normalizeAppearanceSettings({
      layout: { cornerRadius: 500, spaceScale: -3 },
      motion: { speed: 0.01 },
      shadows: { strength: 42 },
      typography: { bodyWeight: 10, headingWeight: 9000, textScale: 9 },
      version: 1,
    });

    expect(normalized.typography.textScale).toBe(APPEARANCE_RANGES.textScale.max);
    expect(normalized.typography.bodyWeight).toBe(APPEARANCE_RANGES.bodyWeight.min);
    expect(normalized.typography.headingWeight).toBe(APPEARANCE_RANGES.headingWeight.max);
    expect(normalized.layout.spaceScale).toBe(APPEARANCE_RANGES.spaceScale.min);
    expect(normalized.layout.cornerRadius).toBe(APPEARANCE_RANGES.cornerRadius.max);
    expect(normalized.shadows.strength).toBe(APPEARANCE_RANGES.shadowStrength.max);
    expect(normalized.motion.speed).toBe(APPEARANCE_RANGES.motionSpeed.min);
  });

  it("normalizes hex colors and rejects malformed ones", () => {  expect.hasAssertions();

    const normalized = normalizeAppearanceSettings({
      colors: { accent: "#ABC", foreground: "#ECE3D5", surface: "#DEADBEEF" },
      version: 1,
    });

    expect(normalized.colors.accent).toBe("#aabbcc");
    expect(normalized.colors.surface).toBe(APPEARANCE_DEFAULTS.colors.surface);
    expect(normalized.colors.foreground).toBe("#ece3d5");
  });
});

describe("load/save/subscribe", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("stores and reloads one validated settings object", () => {  expect.hasAssertions();

    saveAppearanceSettings(
      normalizeAppearanceSettings({ colors: { border: "#334455" }, version: 1 }),
    );

    expect(globalThis.localStorage.getItem(STORAGE_KEYS.APPEARANCE_SETTINGS)).toBeTruthy();
    const loaded = loadAppearanceSettings();
    expect(loaded.colors.border).toBe("#334455");
    expect(loaded.version).toBe(1);
  });

  it("returns a stable snapshot reference until storage changes", () => {  expect.hasAssertions();

    const first = loadAppearanceSettings(),
     second = loadAppearanceSettings();
    expect(second).toBe(first);

    saveAppearanceSettings(
      normalizeAppearanceSettings({ colors: { background: "#111111" }, version: 1 }),
    );
    expect(loadAppearanceSettings()).not.toBe(first);
  });

  it("falls back to defaults for corrupt stored JSON", () => {  expect.hasAssertions();

    globalThis.localStorage.setItem(APPEARANCE_STORAGE_KEY, "{definitely not json");
    expect(loadAppearanceSettings()).toStrictEqual(APPEARANCE_DEFAULTS);
  });

  it("notifies subscribers on save and stops after unsubscribe", () => {  expect.hasAssertions();

    const snapshots: string[] = [],
     unsubscribe = subscribeToAppearanceSettings(() => {
      snapshots.push(loadAppearanceSettings().colors.accent);
    });

    saveAppearanceSettings(normalizeAppearanceSettings({ colors: { accent: "#112233" }, version: 1 }));
    unsubscribe();
    saveAppearanceSettings(normalizeAppearanceSettings({ colors: { accent: "#445566" }, version: 1 }));

    expect(snapshots).toStrictEqual(["#112233"]);
  });

  it("reset clears the persisted overrides", () => {  expect.hasAssertions();

    saveAppearanceSettings(normalizeAppearanceSettings({ colors: { accent: "#112233" }, version: 1 }));
    expect(resetAppearanceSettings()).toBe(true);
    expect(loadAppearanceSettings()).toStrictEqual(APPEARANCE_DEFAULTS);
  });
});

describe("applyAppearanceSettings", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    delete document.documentElement.dataset.motionOff;
    applyAppearanceSettings(APPEARANCE_DEFAULTS);
  });

  it("writes only tokens that differ from their defaults", () => {  expect.hasAssertions();

    applyAppearanceSettings(
      normalizeAppearanceSettings({
        colors: { accent: "#ff8800" },
        layout: { cornerRadius: 12 },
        version: 1,
      }),
    );

    const {style} = document.documentElement;
    expect(style.getPropertyValue("--primary")).toBe("#ff8800");
    expect(style.getPropertyValue("--ring")).toBe("#ff8800");
    expect(style.getPropertyValue("--radius")).toBe("0.75rem");
    // Neutral tokens must stay theme-controlled.
    expect(style.getPropertyValue("--background")).toBe("");
    expect(style.getPropertyValue("--card")).toBe("");
    expect(Object.hasOwn(document.documentElement.dataset, "motionOff")).toBe(false);
  });

  it("removes a previously written token once it returns to its default", () => {  expect.hasAssertions();

    const customized = normalizeAppearanceSettings({
      colors: { accent: "#ff8800" },
      motion: { enabled: false },
      version: 1,
    });
    applyAppearanceSettings(customized);
    expect(document.documentElement.dataset.motionOff).toBe("true");

    applyAppearanceSettings(APPEARANCE_DEFAULTS);
    const {style} = document.documentElement;
    expect(style.getPropertyValue("--primary")).toBe("");
    expect(Object.hasOwn(document.documentElement.dataset, "motionOff")).toBe(false);
  });
});

describe("buildAppearanceBootstrapScript", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    delete document.documentElement.dataset.motionOff;
    applyAppearanceSettings(APPEARANCE_DEFAULTS);
  });

  it("mirrors applied settings before hydration", () => {  expect.hasAssertions();

    globalThis.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        colors: { accent: "#123abc" },
        layout: { spaceScale: 0.9 },
        motion: { enabled: false },
        typography: { textScale: 1.2 },
        version: 1,
      }),
    );

    (0, eval)(buildAppearanceBootstrapScript());

    const {style} = document.documentElement;
    expect(style.getPropertyValue("--primary")).toBe("#123abc");
    expect(style.getPropertyValue("--ring")).toBe("#123abc");
    expect(style.getPropertyValue("--appearance-text-scale")).toBe("1.2");
    expect(style.getPropertyValue("--appearance-space-scale")).toBe("0.9");
    expect(document.documentElement.dataset.motionOff).toBe("true");
  });

  it("ignores corrupt payloads and leaves theme tokens alone", () => {  expect.hasAssertions();

    globalThis.localStorage.setItem(APPEARANCE_STORAGE_KEY, "{{{");
    expect(() => (0, eval)(buildAppearanceBootstrapScript())).not.toThrow();
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");

    globalThis.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ version: 7 }));
    (0, eval)(buildAppearanceBootstrapScript());
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });
});

describe("storage key registration", () => {
  it("exposes the appearance key through the shared key map", () => {  expect.hasAssertions();

    expect(STORAGE_KEYS.APPEARANCE_SETTINGS).toBe("appearanceSettings");
    expect(APPEARANCE_STORAGE_KEY).toBe(STORAGE_KEYS.APPEARANCE_SETTINGS);
    expect(getServerAppearanceSettings()).toBe(APPEARANCE_DEFAULTS);
  });
});
