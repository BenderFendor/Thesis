import { hasText } from "@/lib/utils";

const getBiasColor = (bias: string): string => {
  switch (bias) {
    case "left": {
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    }
    case "center": {
      return "bg-white/5 text-muted-foreground border-white/10";
    }
    case "right": {
      return "bg-red-500/10 text-red-400 border-red-500/20";
    }
    default: {
      return "bg-white/5 text-muted-foreground border-white/10";
    }
  }
};

const getCredibilityColor = (credibility: string): string => {
  switch (credibility) {
    case "high": {
      return "bg-primary/10 text-primary border-primary/20";
    }
    case "medium": {
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    }
    case "low": {
      return "bg-red-500/10 text-red-400 border-red-500/20";
    }
    default: {
      return "bg-white/5 text-muted-foreground border-white/10";
    }
  }
};

const getWebsiteHostname = (url?: string | null): string | undefined => {
  if (!hasText(url)) {
    return void 0;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return void 0;
  }
};

const navigateBack = (back: () => void, push: (href: string) => void): void => {
  if (globalThis.window !== undefined && globalThis.history.length > 1) {
    back();
    return;
  }
  push("/");
};

const getSourceErrorMessage = (hasError: boolean): string => {
  if (hasError) {
    return "Failed to load source data";
  }
  return "Source not found";
};

const getFavoriteClassName = (favorite: boolean): string => {
  if (favorite) {
    return "fill-primary text-primary";
  }
  return "text-muted-foreground";
};

const getCoverageLabel = (loading: boolean, count: number): string => {
  if (loading) {
    return "Syncing...";
  }
  return `${count} Stories`;
};

export {
  getBiasColor,
  getCoverageLabel,
  getCredibilityColor,
  getFavoriteClassName,
  getSourceErrorMessage,
  getWebsiteHostname,
  navigateBack,
};
