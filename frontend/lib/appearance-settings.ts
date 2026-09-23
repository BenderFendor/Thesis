/**
 * Appearance settings model: one validated settings object that drives the
 * runtime CSS-variable token layer (see app/globals.css "runtime appearance"
 * blocks). Controls edit semantic tokens; components keep their classes.
 *
 * Persistence: localStorage under STORAGE_KEYS.APPEARANCE_SETTINGS.
 * Application: documentElement inline style properties, diffed against
 * APPEARANCE_DEFAULTS so untouched tokens keep following the active theme.
 */

import {
  STORAGE_KEYS,
  removeFromStorage,
  parseStoredJson,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage";

interface AppearanceColorTokens {
  readonly background: string;
  readonly surface: string;
  readonly foreground: string;
  readonly secondaryText: string;
  readonly accent: string;
  readonly border: string;
}

interface AppearanceTypographyTokens {
  /** Multiplier applied to every named Tailwind text size. */
  readonly textScale: number;
  readonly bodyWeight: number;
  readonly headingWeight: number;
}

interface AppearanceLayoutTokens {
  /** Multiplier applied to the Tailwind spacing unit. */
  readonly spaceScale: number;
  /** Corner radius in pixels; drives --radius. */
  readonly cornerRadius: number;
}

interface AppearanceShadowTokens {
  /** Multiplier on the alpha of standard Tailwind box shadows. */
  readonly strength: number;
}

interface AppearanceMotionTokens {
  readonly enabled: boolean;
  /** Multiplier on the default transition duration. */
  readonly speed: number;
}

interface AppearanceSettings {
  readonly version: 1;
  readonly colors: AppearanceColorTokens;
  readonly typography: AppearanceTypographyTokens;
  readonly layout: AppearanceLayoutTokens;
  readonly shadows: AppearanceShadowTokens;
  readonly motion: AppearanceMotionTokens;
}

interface AppearanceInputRecord extends Readonly<Record<string, AppearanceInput>> {
  readonly __appearanceInputRecord?: never;
}

type AppearanceInput =
  | string
  | number
  | boolean
  | null
  | readonly AppearanceInput[]
  | AppearanceInputRecord
  | undefined;
type AppearanceSettingsInput = Readonly<AppearanceSettings> | AppearanceInput;

type AppearanceRecord = AppearanceInputRecord;

/**
 * Dark-first palette anchors taken from the .dark block in globals.css.
 * A field equal to its default means "no override": the theme keeps control.
 */
const APPEARANCE_DEFAULTS: AppearanceSettings = Object.freeze({
    colors: Object.freeze({
      accent: "#d0af73",
      background: "#000000",
      border: "#222222",
      foreground: "#ece3d5",
      secondaryText: "#9d917f",
      surface: "#0a0a0a",
    }),
    layout: Object.freeze({
      cornerRadius: 6,
      spaceScale: 1,
    }),
    motion: Object.freeze({
      enabled: true,
      speed: 1,
    }),
    shadows: Object.freeze({
      strength: 1,
    }),
    typography: Object.freeze({
      bodyWeight: 400,
      headingWeight: 600,
      textScale: 1,
    }),
    version: 1,
  }),
  /** Numeric slider bounds shared by the model and the settings page controls. */
  APPEARANCE_RANGES = {
    bodyWeight: { max: 700, min: 300, step: 50 },
    cornerRadius: { max: 18, min: 0, step: 1 },
    headingWeight: { max: 800, min: 400, step: 50 },
    motionSpeed: { max: 2, min: 0.5, step: 0.05 },
    shadowStrength: { max: 2, min: 0, step: 0.05 },
    spaceScale: { max: 1.25, min: 0.85, step: 0.05 },
    textScale: { max: 1.3, min: 0.85, step: 0.05 },
  } as const,
  APPEARANCE_STORAGE_KEY = STORAGE_KEYS.APPEARANCE_SETTINGS,
  /** Root CSS properties overridden per color token; --ring follows --accent. */
  COLOR_PROPERTY_BY_TOKEN = {
    accent: ["--primary", "--ring"],
    background: "--background",
    border: "--border",
    foreground: "--foreground",
    secondaryText: "--muted-foreground",
    surface: "--card",
  } as const satisfies Record<keyof AppearanceColorTokens, string | readonly string[]>,
  COLOR_TOKENS = [
    "accent",
    "background",
    "border",
    "foreground",
    "secondaryText",
    "surface",
  ] as const satisfies readonly (keyof AppearanceColorTokens)[],
  HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u,
  /** Neutral values that mean "no override" for the numeric root properties. */
  NEUTRAL_NUMBER_BY_PROPERTY = {
    "--appearance-font-weight-body": APPEARANCE_DEFAULTS.typography.bodyWeight,
    "--appearance-font-weight-heading": APPEARANCE_DEFAULTS.typography.headingWeight,
    "--appearance-motion-speed": 1,
    "--appearance-shadow-strength": 1,
    "--appearance-space-scale": 1,
    "--appearance-text-scale": 1,
    // Stored in pixels; applied as rem against a 16px root font size.
    "--radius": APPEARANCE_DEFAULTS.layout.cornerRadius,
  } as const satisfies Readonly<Record<string, number>>;

const getServerAppearanceSettings = (): AppearanceSettings =>
  // Stable frozen reference required by useSyncExternalStore server snapshots.
  APPEARANCE_DEFAULTS;

const isFiniteNumber = (value: AppearanceInput): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isString = (value: AppearanceInput): value is string => typeof value === "string";

const clampNumber = (
  value: AppearanceInput,
  range: Readonly<{ min: number; max: number }>,
  fallback: number,
): number => {
  if (!isFiniteNumber(value)) {
    return fallback;
  }
  return Math.min(range.max, Math.max(range.min, value));
};

const normalizeHexColor = (value: AppearanceInput, fallback: string): string => {
  if (!isString(value) || !HEX_COLOR_PATTERN.test(value)) {
    return fallback;
  }
  const hex = value.toLowerCase();
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
};

/**
 * Validate arbitrary input into the total settings model.
 * @param {Readonly<AppearanceInput>} input Candidate settings payload.
 * @returns {AppearanceSettings} Normalized settings with safe defaults.
 */
const normalizeAppearanceSettings = (
  input: AppearanceSettingsInput,
): AppearanceSettings => {
  const settings = appearanceInputGroups(input);
  if (settings.source.version !== 1) {
    return { ...APPEARANCE_DEFAULTS };
  }

  return {
    colors: normalizeColors(settings.colors),
    layout: normalizeLayout(settings.layout),
    motion: normalizeMotion(settings.motion),
    shadows: normalizeShadows(settings.shadows),
    typography: normalizeTypography(settings.typography),
    version: 1,
  };
};

const isPlainObject = (value: AppearanceSettingsInput): value is AppearanceRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const group = (value: AppearanceSettingsInput): AppearanceRecord => {
  if (isPlainObject(value)) {
    return value;
  }
  return {};
};

const normalizeColors = (colors: AppearanceRecord): AppearanceColorTokens => ({
  accent: normalizeHexColor(colors.accent, APPEARANCE_DEFAULTS.colors.accent),
  background: normalizeHexColor(colors.background, APPEARANCE_DEFAULTS.colors.background),
  border: normalizeHexColor(colors.border, APPEARANCE_DEFAULTS.colors.border),
  foreground: normalizeHexColor(colors.foreground, APPEARANCE_DEFAULTS.colors.foreground),
  secondaryText: normalizeHexColor(
    colors.secondaryText,
    APPEARANCE_DEFAULTS.colors.secondaryText,
  ),
  surface: normalizeHexColor(colors.surface, APPEARANCE_DEFAULTS.colors.surface),
});

const normalizeLayout = (layout: AppearanceRecord): AppearanceLayoutTokens => ({
  cornerRadius: clampNumber(
    layout.cornerRadius,
    APPEARANCE_RANGES.cornerRadius,
    APPEARANCE_DEFAULTS.layout.cornerRadius,
  ),
  spaceScale: snapStep(clampNumber(layout.spaceScale, APPEARANCE_RANGES.spaceScale, 1)),
});

const normalizeMotion = (motion: AppearanceRecord): AppearanceMotionTokens => {
  let enabled = true;
  if (motion.enabled !== undefined) {
    enabled = motion.enabled === true;
  }
  return {
    enabled,
    speed: snapStep(clampNumber(motion.speed, APPEARANCE_RANGES.motionSpeed, 1)),
  };
};

const normalizeShadows = (shadows: AppearanceRecord): AppearanceShadowTokens => ({
  strength: snapStep(clampNumber(shadows.strength, APPEARANCE_RANGES.shadowStrength, 1)),
});

const normalizeTypography = (
  typography: AppearanceRecord,
): AppearanceTypographyTokens => ({
  bodyWeight: clampNumber(
    typography.bodyWeight,
    APPEARANCE_RANGES.bodyWeight,
    APPEARANCE_DEFAULTS.typography.bodyWeight,
  ),
  headingWeight: clampNumber(
    typography.headingWeight,
    APPEARANCE_RANGES.headingWeight,
    APPEARANCE_DEFAULTS.typography.headingWeight,
  ),
  textScale: snapStep(clampNumber(typography.textScale, APPEARANCE_RANGES.textScale, 1)),
});

const appearanceInputGroups = (input: AppearanceSettingsInput) => {
  const source = group(input);
  return {
    colors: group(source.colors),
    layout: group(source.layout),
    motion: group(source.motion),
    shadows: group(source.shadows),
    source,
    typography: group(source.typography),
  };
};

/**
 * Slider steps are multiples of 0.05; snap accumulated float drift back onto
 * the grid so stored values compare equal to their neutral defaults.
 * @param {number} value Numeric slider value.
 * @returns {number} Value rounded to the storage step.
 */
const snapStep = (value: number): number => Math.round(value * 100) / 100;

const readRawStorageValue = (): string | null => {
  if (globalThis.window === undefined) {
    return null;
  }
  try {
    return globalThis.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
};

let snapshotCache: { raw: string | null; value: AppearanceSettings } | null = null;

const cacheAppearanceSettings = (raw: string | null): AppearanceSettings => {
  const value = normalizeAppearanceSettings(parseAppearanceStorageValue(raw));
  snapshotCache = { raw, value };
  return value;
};

const parseAppearanceStorageValue = (raw: string | null): AppearanceInput => {
  if (raw === null) {
    return void 0;
  }
  try {
    return parseStoredJson(raw);
  } catch {
    return void 0;
  }
};

/**
 * UseSyncExternalStore-compatible snapshot: parses and validates at most once
 * per stored value, so React sees a stable reference between renders.
 * @returns {AppearanceSettings} Current validated settings snapshot.
 */
const loadAppearanceSettings = (): AppearanceSettings => {
  const raw = readRawStorageValue();
  if (snapshotCache?.raw === raw) {
    return snapshotCache.value;
  }

  return cacheAppearanceSettings(raw);
};

/**
 * Subscribe to persisted appearance changes.
 * @param {() => void} onChange Snapshot listener.
 * @returns {() => void} Unsubscribe callback.
 */
const subscribeToAppearanceSettings = (onChange: () => void): (() => void) =>
  // Reuses the shared storage bus: same-tab custom events plus cross-tab
  // Native storage events.
  subscribeToStorageKey(APPEARANCE_STORAGE_KEY, onChange);

const saveAppearanceSettings = (settings: AppearanceSettings): boolean =>
  saveToStorage(APPEARANCE_STORAGE_KEY, settings);

/**
 * Remove persisted overrides; the next snapshot falls back to defaults.
 * @returns {boolean} Whether storage accepted the removal.
 */
const resetAppearanceSettings = (): boolean => removeFromStorage(APPEARANCE_STORAGE_KEY);

interface AppliedProperty {
  property: string;
  rendered: string;
  neutral: boolean;
}

const colorProperties = (colors: AppearanceColorsInput): AppliedProperty[] => {
  const entries: AppliedProperty[] = [];
  for (const token of COLOR_TOKENS) {
    const propertyOrProperties = COLOR_PROPERTY_BY_TOKEN[token],
      value = colors[token];
    const properties = propertiesForToken(propertyOrProperties);
    for (const property of properties) {
      entries.push({
        neutral: value === APPEARANCE_DEFAULTS.colors[token],
        property,
        rendered: value,
      });
    }
  }
  return entries;
};

const isStringArray = (value: string | readonly string[]): value is readonly string[] =>
  Array.isArray(value);

const propertiesForToken = (value: string | readonly string[]): readonly string[] => {
  if (isStringArray(value)) {
    return value;
  }
  return [value];
};

type AppearanceColorsInput = AppearanceSettings["colors"];

const numericProperties = (settings: AppearanceSettings): AppliedProperty[] => {
  const radiusRem = `${snapStep(settings.layout.cornerRadius / 16)}rem`;
  return [
    {
      neutral: settings.typography.textScale === 1,
      property: "--appearance-text-scale",
      rendered: String(settings.typography.textScale),
    },
    {
      neutral:
        settings.typography.bodyWeight ===
        NEUTRAL_NUMBER_BY_PROPERTY["--appearance-font-weight-body"],
      property: "--appearance-font-weight-body",
      rendered: String(settings.typography.bodyWeight),
    },
    {
      neutral:
        settings.typography.headingWeight ===
        NEUTRAL_NUMBER_BY_PROPERTY["--appearance-font-weight-heading"],
      property: "--appearance-font-weight-heading",
      rendered: String(settings.typography.headingWeight),
    },
    {
      neutral: settings.layout.spaceScale === 1,
      property: "--appearance-space-scale",
      rendered: String(settings.layout.spaceScale),
    },
    {
      neutral: settings.layout.cornerRadius === NEUTRAL_NUMBER_BY_PROPERTY["--radius"],
      property: "--radius",
      rendered: radiusRem,
    },
    {
      neutral: settings.shadows.strength === 1,
      property: "--appearance-shadow-strength",
      rendered: String(settings.shadows.strength),
    },
    {
      neutral: settings.motion.speed === 1,
      property: "--appearance-motion-speed",
      rendered: String(settings.motion.speed),
    },
  ];
};

/**
 * Apply settings as root-level CSS custom properties. Fields equal to their
 * default are removed instead of written, so untouched tokens keep following
 * the light/dark theme classes.
 * @param {AppearanceSettings} settings Validated settings to apply.
 * @returns {void}
 */
const applyAppearanceSettings = (settings: AppearanceSettings): void => {
  if (globalThis.document === undefined) {
    return;
  }
  const { style } = document.documentElement;

  for (const entry of [...colorProperties(settings.colors), ...numericProperties(settings)]) {
    if (entry.neutral) {
      style.removeProperty(entry.property);
    } else {
      style.setProperty(entry.property, entry.rendered);
    }
  }

  if (settings.motion.enabled) {
    delete document.documentElement.dataset.motionOff;
  } else {
    document.documentElement.dataset.motionOff = "true";
  }
};

/**
 * Blocking head snippet that mirrors applyAppearanceSettings before hydration
 * so a reload does not flash unstyled tokens. Keep the validation identical
 * to normalizeAppearanceSettings.
 * @returns {string} Inline bootstrap script.
 */
const buildAppearanceBootstrapScript = (): string => {
  const defaultsJson = JSON.stringify({
      colors: APPEARANCE_DEFAULTS.colors,
      cornerRadius: APPEARANCE_DEFAULTS.layout.cornerRadius,
      motionSpeedRange: APPEARANCE_RANGES.motionSpeed,
      typography: APPEARANCE_DEFAULTS.typography,
    }),
    ranges = JSON.stringify(APPEARANCE_RANGES);

  return `(function(){try{
var d=${defaultsJson};var R=${ranges};
var raw=globalThis.localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});
if(!raw){return;}
var s=JSON.parse(raw);
if(!s||s.version!==1){return;}
function hx(v,f){return (typeof v==="string"&&/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v))?v.toLowerCase():f;}
function num(v,min,max,f){if(typeof v!=="number"||!isFinite(v)){return f;}return Math.min(max,Math.max(min,v));}
function put(name,value,neutral){style.removeProperty(name);if(!neutral){style.setProperty(name,value);}}
function col(name,v,f){var x=hx(v,f);put(name,x,x===f);}
var style=document.documentElement.style;
var g=s.colors||{},t=s.typography||{},l=s.layout||{},sh=s.shadows||{},m=s.motion||{};
col("--background",g.background,d.colors.background);
col("--card",g.surface,d.colors.surface);
col("--foreground",g.foreground,d.colors.foreground);
col("--muted-foreground",g.secondaryText,d.colors.secondaryText);
col("--primary",g.accent,d.colors.accent);
col("--ring",g.accent,d.colors.accent);
col("--border",g.border,d.colors.border);
var ts=num(t.textScale,R.textScale.min,R.textScale.max,1);put("--appearance-text-scale",String(ts),ts===1);
var bw=num(t.bodyWeight,R.bodyWeight.min,R.bodyWeight.max,d.typography.bodyWeight);put("--appearance-font-weight-body",String(bw),bw===d.typography.bodyWeight);
var hw=num(t.headingWeight,R.headingWeight.min,R.headingWeight.max,d.typography.headingWeight);put("--appearance-font-weight-heading",String(hw),hw===d.typography.headingWeight);
var ss=num(l.spaceScale,R.spaceScale.min,R.spaceScale.max,1);put("--appearance-space-scale",String(ss),ss===1);
var cr=num(l.cornerRadius,R.cornerRadius.min,R.cornerRadius.max,d.cornerRadius);put("--radius",(Math.round(cr/16*100)/100)+"rem",cr===d.cornerRadius);
var st=num(sh.strength,R.shadowStrength.min,R.shadowStrength.max,1);put("--appearance-shadow-strength",String(st),st===1);
var ms=num(m.speed,d.motionSpeedRange.min,d.motionSpeedRange.max,1);put("--appearance-motion-speed",String(ms),ms===1);
if(m.enabled===false){document.documentElement.setAttribute("data-motion-off","true");}
}catch{}})();`;
};

export {
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
};

export type {
  AppearanceColorTokens,
  AppearanceLayoutTokens,
  AppearanceMotionTokens,
  AppearanceSettings,
  AppearanceShadowTokens,
  AppearanceTypographyTokens,
};
