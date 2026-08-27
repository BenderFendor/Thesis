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
  it("returns untouched defaults for null, junk, or wrong versions", () => {
    expect(normalizeAppearanceSettings(null)).toEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearanceSettings("nope")).toEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearanceSettings({ version: 99 })).toEqual(APPEARANCE_DEFAULTS);
    expect(normalizeAppearanceSettings({})).toEqual(APPEARANCE_DEFAULTS);
  });

  it("keeps valid values and drops unknown keys", () => {
    const normalized = normalizeAppearanceSettings({
      version: 1,
      colors: { accent: "#ff0000" },
      typography: { textScale: 1.15 },
      hackerField: "drop me",
    });

    expect(normalized.colors.accent).toBe("#ff0000");
    expect(normalized.colors.background).toBe(APPEARANCE_DEFAULTS.colors.background);
    expect(normalized.typography.textScale).toBeCloseTo(1.15);
    expect(normalized).not.toHaveProperty("hackerField");
  });

  it("clamps numbers into the documented ranges", () => {
    const normalized = normalizeAppearanceSettings({
      version: 1,
      typography: { textScale: 9, bodyWeight: 10, headingWeight: 9000 },
      layout: { spaceScale: -3, cornerRadius: 500 },
      shadows: { strength: 42 },
      motion: { speed: 0.01 },
    });

    expect(normalized.typography.textScale).toBe(APPEARANCE_RANGES.textScale.max);
    expect(normalized.typography.bodyWeight).toBe(APPEARANCE_RANGES.bodyWeight.min);
    expect(normalized.typography.headingWeight).toBe(APPEARANCE_RANGES.headingWeight.max);
    expect(normalized.layout.spaceScale).toBe(APPEARANCE_RANGES.spaceScale.min);
    expect(normalized.layout.cornerRadius).toBe(APPEARANCE_RANGES.cornerRadius.max);
    expect(normalized.shadows.strength).toBe(APPEARANCE_RANGES.shadowStrength.max);
    expect(normalized.motion.speed).toBe(APPEARANCE_RANGES.motionSpeed.min);
  });

  it("normalizes hex colors and rejects malformed ones", () => {
    const normalized = normalizeAppearanceSettings({
      version: 1,
      colors: { accent: "#ABC", surface: "#DEADBEEF", foreground: "#ECE3D5" },
    });

    expect(normalized.colors.accent).toBe("#aabbcc");
    expect(normalized.colors.surface).toBe(APPEARANCE_DEFAULTS.colors.surface);
    expect(normalized.colors.foreground).toBe("#ece3d5");
  });
});

describe("load/save/subscribe", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores and reloads one validated settings object", () => {
    saveAppearanceSettings(
      normalizeAppearanceSettings({ version: 1, colors: { border: "#334455" } }),
    );

    expect(window.localStorage.getItem(STORAGE_KEYS.APPEARANCE_SETTINGS)).toBeTruthy();
    const loaded = loadAppearanceSettings();
    expect(loaded.colors.border).toBe("#334455");
    expect(loaded.version).toBe(1);
  });

  it("returns a stable snapshot reference until storage changes", () => {
    const first = loadAppearanceSettings();
    const second = loadAppearanceSettings();
    expect(second).toBe(first);

    saveAppearanceSettings(
      normalizeAppearanceSettings({ version: 1, colors: { background: "#111111" } }),
    );
    expect(loadAppearanceSettings()).not.toBe(first);
  });

  it("falls back to defaults for corrupt stored JSON", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "{definitely not json");
    expect(loadAppearanceSettings()).toEqual(APPEARANCE_DEFAULTS);
  });

  it("notifies subscribers on save and stops after unsubscribe", () => {
    const snapshots: string[] = [];
    const unsubscribe = subscribeToAppearanceSettings(() => {
      snapshots.push(loadAppearanceSettings().colors.accent);
    });

    saveAppearanceSettings(normalizeAppearanceSettings({ version: 1, colors: { accent: "#112233" } }));
    unsubscribe();
    saveAppearanceSettings(normalizeAppearanceSettings({ version: 1, colors: { accent: "#445566" } }));

    expect(snapshots).toEqual(["#112233"]);
  });

  it("reset clears the persisted overrides", () => {
    saveAppearanceSettings(normalizeAppearanceSettings({ version: 1, colors: { accent: "#112233" } }));
    expect(resetAppearanceSettings()).toBe(true);
    expect(loadAppearanceSettings()).toEqual(APPEARANCE_DEFAULTS);
  });
});

describe("applyAppearanceSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-motion-off");
    applyAppearanceSettings(APPEARANCE_DEFAULTS);
  });

  it("writes only tokens that differ from their defaults", () => {
    applyAppearanceSettings(
      normalizeAppearanceSettings({
        version: 1,
        colors: { accent: "#ff8800" },
        layout: { cornerRadius: 12 },
      }),
    );

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--primary")).toBe("#ff8800");
    expect(style.getPropertyValue("--ring")).toBe("#ff8800");
    expect(style.getPropertyValue("--radius")).toBe("0.75rem");
    // Neutral tokens must stay theme-controlled.
    expect(style.getPropertyValue("--background")).toBe("");
    expect(style.getPropertyValue("--card")).toBe("");
    expect(document.documentElement.hasAttribute("data-motion-off")).toBe(false);
  });

  it("removes a previously written token once it returns to its default", () => {
    const customized = normalizeAppearanceSettings({
      version: 1,
      colors: { accent: "#ff8800" },
      motion: { enabled: false },
    });
    applyAppearanceSettings(customized);
    expect(document.documentElement.getAttribute("data-motion-off")).toBe("true");

    applyAppearanceSettings(APPEARANCE_DEFAULTS);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--primary")).toBe("");
    expect(document.documentElement.hasAttribute("data-motion-off")).toBe(false);
  });
});

describe("buildAppearanceBootstrapScript", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-motion-off");
    applyAppearanceSettings(APPEARANCE_DEFAULTS);
  });

  it("mirrors applied settings before hydration", () => {
    window.localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        colors: { accent: "#123abc" },
        typography: { textScale: 1.2 },
        layout: { spaceScale: 0.9 },
        motion: { enabled: false },
      }),
    );

    (0, eval)(buildAppearanceBootstrapScript());

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--primary")).toBe("#123abc");
    expect(style.getPropertyValue("--ring")).toBe("#123abc");
    expect(style.getPropertyValue("--appearance-text-scale")).toBe("1.2");
    expect(style.getPropertyValue("--appearance-space-scale")).toBe("0.9");
    expect(document.documentElement.getAttribute("data-motion-off")).toBe("true");
  });

  it("ignores corrupt payloads and leaves theme tokens alone", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "{{{");
    expect(() => (0, eval)(buildAppearanceBootstrapScript())).not.toThrow();
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");

    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ version: 7 }));
    (0, eval)(buildAppearanceBootstrapScript());
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });
});

describe("storage key registration", () => {
  it("exposes the appearance key through the shared key map", () => {
    expect(STORAGE_KEYS.APPEARANCE_SETTINGS).toBe("appearanceSettings");
    expect(APPEARANCE_STORAGE_KEY).toBe(STORAGE_KEYS.APPEARANCE_SETTINGS);
    expect(getServerAppearanceSettings()).toBe(APPEARANCE_DEFAULTS);
  });
});
