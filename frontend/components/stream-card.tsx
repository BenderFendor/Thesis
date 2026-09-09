"use client";

import { AlertTriangle, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEventHandler } from 'react';
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

const buildEmbedUrl = (channelId: string, muted: boolean): string => {
  const mute = (() => {
  if (muted) {
    return "1";
  }
  return "0";
})();
  return (
    `https://www.youtube.com/embed/live_stream?channel=${channelId}` +
    `&enablejsapi=1&autoplay=1&mute=${mute}&controls=1&modestbranding=1&rel=0`
  );
};

const YouTubeMessageSchema = z.object({ event: z.string().optional() });

export const StreamCard = ({
  source,
  muted,
  loaded,
  isFullscreen,
  onToggleMute,
  onClose,
  onDoubleClick,
  onBecameVisible,
  onBecameHidden,
}: Readonly<StreamCardProps>) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hovering, setHovering] = useState(false);
  const [embedError, setEmbedError] = useState(false);
  const observeRef = useRef<IntersectionObserver | null>(null);
  const embedUrl = buildEmbedUrl(source.channelId, muted);
  const handleIframeError = useCallback(() => {
      setEmbedError(true);
    }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return () => {};
    }

    observeRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) {
          onBecameVisible(source.id);
        } else {
          onBecameHidden(source.id);
        }
      },
      { threshold: 0.5 },
    );

    observeRef.current.observe(el);

    return () => {
      observeRef.current?.disconnect();
    };
  }, [source.id, onBecameVisible, onBecameHidden]);

  useEffect(() => {
    if (!loaded) {
      return () => {};
    }

    let errorTimer: ReturnType<typeof setTimeout> | undefined;
    const handleMessage = (event: Readonly<Pick<MessageEvent, "origin" | "data">>) => {
      if (event.origin !== "https://www.youtube.com") {
        return;
      }
      try {
        const parsed = YouTubeMessageSchema.safeParse(JSON.parse(String(event.data)));
        if (parsed.success && parsed.data.event === "error") {
          setEmbedError(true);
        }
      } catch {
        // Not JSON, ignore
      }
    };

    if (iframeRef.current) {
      errorTimer = setTimeout(() => {
        // YouTube error iframes don't fire error events;
        // Detect via the embedded page title pattern
        try {
          const iframeDoc =
            iframeRef.current?.contentDocument ?? iframeRef.current?.contentWindow?.document;
          if (iframeDoc?.title?.includes("Error") === true && iframeDoc.title.includes("YouTube")) {
            setEmbedError(true);
          }
        } catch {
          // Cross-origin, can't inspect content
        }
      }, 8000);
    }

    globalThis.addEventListener("message", handleMessage);
    return () => {
      globalThis.removeEventListener("message", handleMessage);
      if (errorTimer) {
        clearTimeout(errorTimer);
      }
    };
  }, [loaded]);

  const containerStyle = useMemo<CSSProperties>(
      () =>
        (() => {
  if (isFullscreen) {
    return {
      background: "var(--news-bg-primary)",
      inset: 0,
      position: "fixed",
      zIndex: 100
    };
  }
  return {};
})(),
      [isFullscreen],
    );
  const aspectStyle = useMemo<CSSProperties>(
      () => ({ paddingBottom: (() => {
  if (isFullscreen) {
    return "0%";
  }
  return "56.25%";
})() }),
      [isFullscreen],
    );
  const handleMouseEnter = useCallback(() => {
      setHovering(true);
    }, []);
  const handleMouseLeave = useCallback(() => {
      setHovering(false);
    }, []);
  const handleDoubleClick = useCallback(() => {
      onDoubleClick(source.id);
    }, [onDoubleClick, source.id]);
  const handleMuteClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
      (event) => {
        event.stopPropagation();
        onToggleMute(source.id);
      },
      [onToggleMute, source.id],
    );
  const handleCloseClick = useCallback<MouseEventHandler<HTMLButtonElement>>(
      (event) => {
        event.stopPropagation();
        onClose(source.id);
      },
      [onClose, source.id],
    );

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-secondary)] group"
      style={containerStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      <div className="relative w-full" style={aspectStyle}>
        {(() => {
  if (loaded) {
    return <>
            <iframe ref={iframeRef} key={embedUrl} src={embedUrl} title={`${source.label} live stream`} sandbox="allow-scripts allow-presentation" allow="autoplay; encrypted-media" allowFullScreen className="absolute inset-0 w-full h-full border-0 bg-black" onError={handleIframeError} />
            {embedError && <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 gap-2">
                <AlertTriangle className="w-8 h-8 text-amber-400" />
                <span className="font-mono text-xs text-white/60 text-center px-4">
                  {source.label} may not be live right now
                </span>
              </div>}
          </>;
  }
  return <div className="absolute inset-0 flex flex-col items-center justify-center bg-black cursor-pointer">
            <div className="w-16 h-16 rounded-full mb-3 flex items-center justify-center bg-white/10 text-white/60 font-mono text-xl uppercase">
              {source.label.charAt(0)}
            </div>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/70">
              {source.label}
            </span>
            <span className="mt-2 font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">
              Click to load
            </span>
          </div>;
})()}

        {loaded && hovering && !embedError && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2 bg-black/70 backdrop-blur-sm">
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/80 truncate max-w-[120px]">
              {source.label}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleMuteClick}
                className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                title={(() => {
  if (muted) {
    return "Unmute";
  }
  return "Mute";
})()}
              >
                {(() => {
  if (muted) {
    return <VolumeX className="w-4 h-4" />;
  }
  return <Volume2 className="w-4 h-4" />;
})()}
              </button>
              <button
                type="button"
                onClick={handleCloseClick}
                className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
