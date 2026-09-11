"use client";

import { Plus, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { useCallback } from "react";

interface LiveNewsToolbarProps {
  readonly layout: "2x2" | "3x3" | "auto";
  readonly onLayoutChange: (layout: "2x2" | "3x3" | "auto") => void;
  readonly muteState: "all-muted" | "per-source";
  readonly onMuteAll: () => void;
  readonly onUnmuteAll: () => void;
  readonly onReset: () => void;
  readonly onAddSource: () => void;
  readonly activeCount: number;
  readonly totalCount: number;
}

interface LayoutButtonProps {
  readonly layout: "2x2" | "3x3" | "auto";
  readonly onChange: (layout: "2x2" | "3x3" | "auto") => void;
  readonly option: "2x2" | "3x3" | "auto";
}

const getLayoutButtonClass = (layout: LayoutButtonProps["layout"], option: LayoutButtonProps["option"]): string => {
  if (layout === option) {
    return "bg-primary/20 text-primary";
  }
  return "text-muted-foreground hover:text-foreground";
};

const LayoutButton = ({ layout, onChange, option }: Readonly<LayoutButtonProps>) => {
  const handleClick = useCallback(() => {
    onChange(option);
  }, [onChange, option]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`rounded-sm px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] transition-colors ${getLayoutButtonClass(layout, option)}`}
    >
      {option}
    </button>
  );
};

const getMuteLabel = (muteState: LiveNewsToolbarProps["muteState"]): string => {
  if (muteState === "all-muted") {
    return "Unmute All";
  }
  return "Mute All";
};

const getMuteAction = (
  muted: boolean,
  onMuteAll: () => void,
  onUnmuteAll: () => void,
): (() => void) => {
  if (muted) {
    return onUnmuteAll;
  }
  return onMuteAll;
};

const MuteIcon = ({ muted }: Readonly<{ muted: boolean }>) => {
  if (muted) {
    return <VolumeX className="h-3.5 w-3.5" />;
  }
  return <Volume2 className="h-3.5 w-3.5" />;
};

const MuteButton = ({
  muteState,
  onMuteAll,
  onUnmuteAll,
}: Readonly<Pick<LiveNewsToolbarProps, "muteState" | "onMuteAll" | "onUnmuteAll">>) => {
  const muted = muteState === "all-muted";
  const label = getMuteLabel(muteState);
  const handleClick = getMuteAction(muted, onMuteAll, onUnmuteAll);
  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-1.5 rounded-sm border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
      title={label}
    >
      <MuteIcon muted={muted} />
      {label}
    </button>
  );
};

const ResetButton = ({ onReset }: Readonly<Pick<LiveNewsToolbarProps, "onReset">>) => (
  <button
    type="button"
    onClick={onReset}
    className="flex items-center gap-1.5 rounded-sm border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
    title="Reset"
  >
    <RefreshCw className="h-3.5 w-3.5" />
    Reset
  </button>
);

const AddSourceButton = ({
  onAddSource,
}: Readonly<Pick<LiveNewsToolbarProps, "onAddSource">>) => (
  <button
    type="button"
    onClick={onAddSource}
    className="flex items-center gap-1.5 rounded-sm border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
    title="Add Source"
  >
    <Plus className="h-3.5 w-3.5" />
    Add
  </button>
);

const LayoutButtons = ({
  layout,
  onLayoutChange,
}: Readonly<Pick<LiveNewsToolbarProps, "layout" | "onLayoutChange">>) => (
  <div className="flex items-center rounded-sm border border-white/10 bg-white/[0.03] p-0.5">
    {(["2x2", "3x3", "auto"] as const).map((option) => (
      <LayoutButton key={option} layout={layout} onChange={onLayoutChange} option={option} />
    ))}
  </div>
);

export const LiveNewsToolbar = ({
  layout,
  onLayoutChange,
  muteState,
  onMuteAll,
  onUnmuteAll,
  onReset,
  onAddSource,
  activeCount,
  totalCount,
}: Readonly<LiveNewsToolbarProps>) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[var(--news-bg-secondary)]">
    <div className="flex items-center gap-3">
      <LayoutButtons layout={layout} onLayoutChange={onLayoutChange} />

      <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground/60">
        {activeCount}/{totalCount} channels
      </span>
    </div>

    <div className="flex items-center gap-2">
      <MuteButton
        muteState={muteState}
        onMuteAll={onMuteAll}
        onUnmuteAll={onUnmuteAll}
      />
      <ResetButton onReset={onReset} />
      <AddSourceButton onAddSource={onAddSource} />
    </div>
  </div>
);
