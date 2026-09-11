"use client";

import { AlertTriangle, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEventHandler } from "react";
import type { LiveNewsSource } from "@/lib/live-news-sources";
import { z } from "zod";

interface StreamCardProps {
  readonly source: Readonly<LiveNewsSource>;
  readonly muted: boolean;
  readonly loaded: boolean;
  readonly isFullscreen: boolean;
  readonly onToggleMute: (sourceId: string) => void;
  readonly onClose: (sourceId: string) => void;
  readonly onDoubleClick: (sourceId: string) => void;
  readonly onBecameVisible: (sourceId: string) => void;
  readonly onBecameHidden: (sourceId: string) => void;
}

const getMuteQueryParam = (muted: boolean): string => {
  if (muted) {
    return "1";
  }
  return "0";
};

const buildEmbedUrl = (channelId: string, muted: boolean): string => {
  const mute = getMuteQueryParam(muted);
  return (
    `https://www.youtube.com/embed/live_stream?channel=${channelId}` +
    `&enablejsapi=1&autoplay=1&mute=${mute}&controls=1&modestbranding=1&rel=0`
  );
};

const getContainerStyle = (isFullscreen: boolean): CSSProperties => {
  if (isFullscreen) {
    return {
      background: "var(--news-bg-primary)",
      inset: 0,
      position: "fixed",
      zIndex: 100,
    };
  }
  return {};
};

const getAspectStyle = (isFullscreen: boolean): CSSProperties => {
  if (isFullscreen) {
    return { paddingBottom: "0%" };
  }
  return { paddingBottom: "56.25%" };
};

const YouTubeMessageSchema = z.object({ event: z.string().optional() });

const isYouTubeErrorMessage = (data: string): boolean => {
  try {
    const parsed = YouTubeMessageSchema.safeParse(JSON.parse(data));
    return parsed.success && parsed.data.event === "error";
  } catch {
    return false;
  }
};

const useStreamVisibilityObserver = (
  containerRef: Readonly<{ current: HTMLDivElement | null }>,
  sourceId: string,
  onBecameVisible: (sourceId: string) => void,
  onBecameHidden: (sourceId: string) => void,
): void => {
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return () => {};
    }

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) {
          onBecameVisible(sourceId);
        } else {
          onBecameHidden(sourceId);
        }
      },
      { threshold: 0.5 },
    );

    observerRef.current.observe(element);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [containerRef, onBecameHidden, onBecameVisible, sourceId]);
};

const useYouTubeEmbedError = (
  loaded: boolean,
  hasIframeError: () => boolean,
  setEmbedError: (value: boolean) => void,
): void => {
  const handleMessage = useCallback(
    (event: Readonly<Pick<MessageEvent, "origin" | "data">>) => {
      if (event.origin !== "https://www.youtube.com") {
        return;
      }
      if (isYouTubeErrorMessage(String(event.data))) {
        setEmbedError(true);
      }
    },
    [setEmbedError],
  );

  useEffect(() => {
    if (!loaded) {
      return () => {};
    }

    const errorTimer = setTimeout(() => {
      if (hasIframeError()) {
        setEmbedError(true);
      }
    }, 8000);

    globalThis.addEventListener("message", handleMessage);
    return () => {
      globalThis.removeEventListener("message", handleMessage);
      clearTimeout(errorTimer);
    };
  }, [handleMessage, hasIframeError, loaded, setEmbedError]);
};

const useStreamEmbedState = (loaded: boolean) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [embedError, setEmbedError] = useState(false);
  const handleIframeError = useCallback(() => {
    setEmbedError(true);
  }, []);
  const hasIframeError = useCallback(() => {
    try {
      const iframeDoc =
        iframeRef.current?.contentDocument ?? iframeRef.current?.contentWindow?.document;
      return iframeDoc?.title?.includes("Error") === true && iframeDoc.title.includes("YouTube");
    } catch {
      return false;
    }
  }, []);
  useYouTubeEmbedError(loaded, hasIframeError, setEmbedError);
  return { embedError, handleIframeError, iframeRef };
};

interface StreamCardHandlersProps {
  readonly sourceId: string;
  readonly onToggleMute: (sourceId: string) => void;
  readonly onClose: (sourceId: string) => void;
  readonly onDoubleClick: (sourceId: string) => void;
  readonly setHovering: (value: boolean) => void;
}

interface StreamCardHandlers {
  readonly handleMouseEnter: () => void;
  readonly handleMouseLeave: () => void;
  readonly handleDoubleClick: () => void;
  readonly handleMuteClick: MouseEventHandler<HTMLButtonElement>;
  readonly handleCloseClick: MouseEventHandler<HTMLButtonElement>;
}

const useStreamCardHandlers = ({
  sourceId,
  onToggleMute,
  onClose,
  onDoubleClick,
  setHovering,
}: Readonly<StreamCardHandlersProps>): StreamCardHandlers => {
  const handleMouseEnter = useCallback(() => {
    setHovering(true);
  }, [setHovering]);
  const handleMouseLeave = useCallback(() => {
    setHovering(false);
  }, [setHovering]);
  const handleDoubleClick = useCallback(() => {
    onDoubleClick(sourceId);
  }, [onDoubleClick, sourceId]);
  const handleMuteClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      onToggleMute(sourceId);
    },
    [onToggleMute, sourceId],
  );
  const handleCloseClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      onClose(sourceId);
    },
    [onClose, sourceId],
  );

  return {
    handleCloseClick,
    handleDoubleClick,
    handleMouseEnter,
    handleMouseLeave,
    handleMuteClick,
  };
};

const useStreamCardState = (props: Readonly<StreamCardProps>) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const containerStyle = useMemo(() => getContainerStyle(props.isFullscreen), [props.isFullscreen]);
  const aspectStyle = useMemo(() => getAspectStyle(props.isFullscreen), [props.isFullscreen]);
  useStreamVisibilityObserver(
    containerRef,
    props.source.id,
    props.onBecameVisible,
    props.onBecameHidden,
  );
  const handlers = useStreamCardHandlers({
    onClose: props.onClose,
    onDoubleClick: props.onDoubleClick,
    onToggleMute: props.onToggleMute,
    setHovering,
    sourceId: props.source.id,
  });

  return { aspectStyle, containerRef, containerStyle, handlers, hovering };
};

const StreamEmbedError = ({ sourceLabel }: Readonly<{ sourceLabel: string }>) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90">
    <AlertTriangle className="h-8 w-8 text-amber-400" />
    <span className="px-4 text-center font-mono text-xs text-white/60">
      {sourceLabel} may not be live right now
    </span>
  </div>
);

interface StreamEmbedProps {
  readonly embedUrl: string;
  readonly hovering: boolean;
  readonly loaded: boolean;
  readonly muted: boolean;
  readonly sourceLabel: string;
  readonly onClose: MouseEventHandler<HTMLButtonElement>;
  readonly onMute: MouseEventHandler<HTMLButtonElement>;
}

interface StreamEmbedControlsProps {
  readonly embedError: boolean;
  readonly hovering: boolean;
  readonly loaded: boolean;
  readonly muted: boolean;
  readonly sourceLabel: string;
  readonly onClose: MouseEventHandler<HTMLButtonElement>;
  readonly onMute: MouseEventHandler<HTMLButtonElement>;
}

const StreamEmbedControls = ({
  embedError,
  hovering,
  loaded,
  muted,
  sourceLabel,
  onClose,
  onMute,
}: Readonly<StreamEmbedControlsProps>) => {
  if (!loaded) {
    return null;
  }
  if (embedError) {
    return <StreamEmbedError sourceLabel={sourceLabel} />;
  }
  if (!hovering) {
    return null;
  }
  return (
    <StreamControls muted={muted} sourceLabel={sourceLabel} onMute={onMute} onClose={onClose} />
  );
};

const StreamEmbed = ({
  embedUrl,
  hovering,
  loaded,
  muted,
  sourceLabel,
  onClose,
  onMute,
}: Readonly<StreamEmbedProps>) => {
  const { embedError, handleIframeError, iframeRef } = useStreamEmbedState(loaded);

  return (
    <>
      {loaded && (
        <iframe
          ref={iframeRef}
          key={embedUrl}
          src={embedUrl}
          title={`${sourceLabel} live stream`}
          sandbox="allow-scripts allow-presentation"
          allow="autoplay; encrypted-media"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0 bg-black"
          onError={handleIframeError}
        />
      )}
      <StreamEmbedControls
        embedError={embedError}
        hovering={hovering}
        loaded={loaded}
        muted={muted}
        sourceLabel={sourceLabel}
        onClose={onClose}
        onMute={onMute}
      />
    </>
  );
};

const StreamPlaceholderBadge = ({ sourceLabel }: Readonly<{ sourceLabel: string }>) => (
  <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/10 font-mono text-xl uppercase text-white/60">
    {sourceLabel.charAt(0)}
  </div>
);

const StreamPlaceholderDetails = ({ sourceLabel }: Readonly<{ sourceLabel: string }>) => (
  <>
    <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/70">
      {sourceLabel}
    </span>
    <span className="mt-2 font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">
      Click to load
    </span>
  </>
);

const StreamPlaceholder = ({ sourceLabel }: Readonly<{ sourceLabel: string }>) => (
  <div className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center bg-black">
    <StreamPlaceholderBadge sourceLabel={sourceLabel} />
    <StreamPlaceholderDetails sourceLabel={sourceLabel} />
  </div>
);

const StreamMuteIcon = ({ muted }: Readonly<{ muted: boolean }>) => {
  if (muted) {
    return <VolumeX className="h-4 w-4" />;
  }
  return <Volume2 className="h-4 w-4" />;
};

const getMuteButtonTitle = (muted: boolean): string => {
  if (muted) {
    return "Unmute";
  }
  return "Mute";
};

const StreamMuteButton = ({
  muted,
  onClick,
}: Readonly<{ muted: boolean; onClick: MouseEventHandler<HTMLButtonElement> }>) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
    title={getMuteButtonTitle(muted)}
  >
    <StreamMuteIcon muted={muted} />
  </button>
);

const StreamCloseButton = ({
  onClick,
}: Readonly<{ onClick: MouseEventHandler<HTMLButtonElement> }>) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
    title="Close"
  >
    <X className="h-4 w-4" />
  </button>
);

interface StreamControlsProps {
  readonly muted: boolean;
  readonly sourceLabel: string;
  readonly onMute: MouseEventHandler<HTMLButtonElement>;
  readonly onClose: MouseEventHandler<HTMLButtonElement>;
}

const StreamControls = ({ muted, sourceLabel, onMute, onClose }: Readonly<StreamControlsProps>) => (
  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/70 px-3 py-2 backdrop-blur-sm">
    <span className="max-w-[120px] truncate font-mono text-[9px] uppercase tracking-[0.15em] text-white/80">
      {sourceLabel}
    </span>
    <div className="flex items-center gap-1">
      <StreamMuteButton muted={muted} onClick={onMute} />
      <StreamCloseButton onClick={onClose} />
    </div>
  </div>
);

interface StreamCardContentProps {
  readonly aspectStyle: Readonly<CSSProperties>;
  readonly embedUrl: string;
  readonly hovering: boolean;
  readonly loaded: boolean;
  readonly muted: boolean;
  readonly sourceLabel: string;
  readonly onClose: MouseEventHandler<HTMLButtonElement>;
  readonly onMute: MouseEventHandler<HTMLButtonElement>;
}

const StreamCardContent = (props: Readonly<StreamCardContentProps>) => (
  <div className="relative w-full" style={props.aspectStyle}>
    <StreamEmbed
      embedUrl={props.embedUrl}
      hovering={props.hovering}
      loaded={props.loaded}
      muted={props.muted}
      sourceLabel={props.sourceLabel}
      onClose={props.onClose}
      onMute={props.onMute}
    />
    {!props.loaded && <StreamPlaceholder sourceLabel={props.sourceLabel} />}
  </div>
);

export const StreamCard = (props: Readonly<StreamCardProps>) => {
  const { aspectStyle, containerRef, containerStyle, handlers, hovering } =
    useStreamCardState(props);

  return (
    <div
      ref={containerRef}
      className="group relative overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-secondary)]"
      style={containerStyle}
      onMouseEnter={handlers.handleMouseEnter}
      onMouseLeave={handlers.handleMouseLeave}
      onDoubleClick={handlers.handleDoubleClick}
    >
      <StreamCardContent
        aspectStyle={aspectStyle}
        embedUrl={buildEmbedUrl(props.source.channelId, props.muted)}
        hovering={hovering}
        loaded={props.loaded}
        muted={props.muted}
        sourceLabel={props.source.label}
        onClose={handlers.handleCloseClick}
        onMute={handlers.handleMuteClick}
      />
    </div>
  );
};
