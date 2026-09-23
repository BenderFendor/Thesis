"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppearanceSettings } from "@/lib/appearance-settings";
import type { CSSProperties } from "react";
import { COLOR_FIELDS } from "./settings-metadata";
import type { ColorField } from "./settings-metadata";

const getPreviewSwatchStyle = (value: string): CSSProperties => ({ backgroundColor: value });

const PreviewSwatch = ({ field, value }: Readonly<{ field: ColorField; value: string }>) => (
  <div className="space-y-1">
    <div
      className="h-6 w-full rounded-sm border border-border"
      style={getPreviewSwatchStyle(value)}
    />
    <span className="block truncate font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
      {field.label}
    </span>
  </div>
);

const PreviewSwatches = ({ settings }: Readonly<{ settings: Readonly<AppearanceSettings> }>) => (
  <div className="grid grid-cols-3 gap-2 border-t border-border p-4">
    {COLOR_FIELDS.map((field) => (
      <PreviewSwatch
        key={`swatch-${field.token}`}
        field={field}
        value={settings.colors[field.token]}
      />
    ))}
  </div>
);

const PreviewCardContent = () => (
  <div className="space-y-3 p-4">
    <Badge className="font-mono text-[10px] uppercase tracking-widest">Breaking</Badge>
    <h3 className="font-serif text-xl font-semibold leading-snug text-foreground">
      Senate report questions coverage of funding vote
    </h3>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Reporters followed the story across three outlets, comparing framing, sourcing, and what each
      left out of the record.
    </p>
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button type="button" size="sm">
        Read analysis
      </Button>
      <Button type="button" size="sm" variant="outline">
        Save for later
      </Button>
    </div>
  </div>
);

const PreviewCard = ({ settings }: Readonly<{ settings: Readonly<AppearanceSettings> }>) => (
  <div className="rounded-md border border-border bg-card shadow-md">
    <PreviewCardContent />
    <div className="border-t border-border p-4">
      <Input placeholder="Search sources" aria-label="Search sources preview" />
    </div>
    <PreviewSwatches settings={settings} />
  </div>
);

const AppearancePreview = ({ settings }: Readonly<{ settings: Readonly<AppearanceSettings> }>) => (
  <aside className="w-full shrink-0 lg:w-80" aria-label="Live preview">
    <div className="space-y-4 lg:sticky lg:top-6">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Live preview
      </p>
      <PreviewCard settings={settings} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        This preview and the surrounding workspace share the same tokens. Move a control and watch
        both react without a reload.
      </p>
    </div>
  </aside>
);

export { AppearancePreview };
