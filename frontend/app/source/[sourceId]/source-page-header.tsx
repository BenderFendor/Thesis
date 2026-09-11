import { useCallback } from "react";
import { ArrowLeft, BookOpen, Star } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getBiasColor, getCredibilityColor, getFavoriteClassName } from "./source-page-helpers";
import type { ReadonlySourcePageSource } from "./source-page-types";

interface SourceHeaderProps {
  readonly source: ReadonlySourcePageSource;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly toggleFavorite: (sourceId: string) => void;
  readonly onBack: () => void;
}

const SourceFavoriteButton = ({
  source,
  isFavorite,
  toggleFavorite,
}: Readonly<Pick<SourceHeaderProps, "source" | "isFavorite" | "toggleFavorite">>) => {
  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(source.id);
  }, [source.id, toggleFavorite]);
  const favoriteClassName = getFavoriteClassName(isFavorite(source.id));

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggleFavorite}
      className="h-6 w-6 rounded-full hover:bg-white/5"
    >
      <Star className={`w-3.5 h-3.5 transition-colors ${favoriteClassName}`} />
    </Button>
  );
};

const SourceWikiLink = ({
  source,
}: Readonly<Pick<SourceHeaderProps, "source">>) => (
  <Link
    href={`/wiki/source/${encodeURIComponent(source.name)}`}
    className="text-muted-foreground hover:text-primary transition-colors"
    title="View wiki profile"
  >
    <BookOpen className="w-4 h-4" />
  </Link>
);

const SourceHeaderIdentity = ({
  source,
  isFavorite,
  toggleFavorite,
  onBack,
}: Readonly<SourceHeaderProps>) => (
  <div className="flex items-center gap-6">
    <Button
      variant="ghost"
      size="sm"
      onClick={onBack}
      className="h-8 px-2 text-muted-foreground hover:text-foreground hover:bg-white/5"
    >
      <ArrowLeft className="w-4 h-4 mr-2" />
      <span className="text-[10px] font-mono uppercase tracking-[0.2em]">Back</span>
    </Button>
    <div className="h-4 w-px bg-white/10" />
    <div className="flex items-center gap-3">
      <h1 className="font-serif text-lg font-bold tracking-tight">{source.name}</h1>
      <SourceWikiLink source={source} />
      <SourceFavoriteButton
        source={source}
        isFavorite={isFavorite}
        toggleFavorite={toggleFavorite}
      />
    </div>
  </div>
);

const SourceHeaderBadges = ({ source }: Readonly<Pick<SourceHeaderProps, "source">>) => (
  <div className="flex items-center gap-2">
    <Badge
      variant="outline"
      className={`rounded-sm px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] ${getCredibilityColor(source.credibility)}`}
    >
      {source.credibility} Credibility
    </Badge>
    <Badge
      variant="outline"
      className={`rounded-sm px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] ${getBiasColor(source.bias)}`}
    >
      {source.bias} Bias
    </Badge>
  </div>
);

const SourceHeader = (props: Readonly<SourceHeaderProps>) => (
  <header className="sticky top-0 z-50 border-b border-white/10 bg-[var(--news-bg-primary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--news-bg-primary)]/80">
    <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
      <SourceHeaderIdentity
        source={props.source}
        isFavorite={props.isFavorite}
        toggleFavorite={props.toggleFavorite}
        onBack={props.onBack}
      />
      <SourceHeaderBadges source={props.source} />
    </div>
  </header>
);

export { SourceHeader };
