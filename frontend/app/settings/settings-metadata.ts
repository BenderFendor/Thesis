import type { AppearanceColorTokens } from "@/lib/appearance-settings";

interface ColorField {
  readonly label: string;
  readonly token: keyof AppearanceColorTokens;
}

interface DensityOption {
  readonly label: string;
  readonly scale: number;
  readonly value: string;
}

const COLOR_FIELDS: readonly ColorField[] = [
    { label: "Background", token: "background" },
    { label: "Surface", token: "surface" },
    { label: "Text", token: "foreground" },
    { label: "Secondary text", token: "secondaryText" },
    { label: "Accent", token: "accent" },
    { label: "Border", token: "border" },
  ],
  DENSITY_OPTIONS: readonly DensityOption[] = [
    { label: "Compact", scale: 0.9, value: "Compact" },
    { label: "Default", scale: 1, value: "Default" },
    { label: "Roomy", scale: 1.1, value: "Roomy" },
  ];

export type { ColorField, DensityOption };
export { COLOR_FIELDS, DENSITY_OPTIONS };
