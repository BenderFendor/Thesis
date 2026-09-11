import { Badge } from "@/components/ui/badge";
import { SafeImage } from "@/components/safe-image";
import { MapPin } from "lucide-react";
import type { CountryListItem, NewsArticle } from "@/lib/api";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { isUsableImage } from "@/lib/article-image";
import type { CountrySelection } from "@/lib/globe-workspace";
import { briefingDescriptionFor, hasText } from "@/lib/globe-workspace";
import { ICON_SIZE } from "./globe-view-shared";
import type { GlobeLensResponse } from "./globe-view-shared";

interface CollapsedLensBriefProps {
  readonly selectedCountry: CountrySelection;
  readonly localLensData: GlobeLensResponse | undefined;
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined;
}

const CollapsedLensBriefHeader = () => (
  <div className="mb-2 flex items-center gap-2">
    <MapPin size={ICON_SIZE} className="text-primary" />
    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      Lens brief
    </span>
  </div>
);

const CollapsedLensBriefSignal = (
  props: Readonly<Pick<CollapsedLensBriefProps, "localLensData">>,
) => {
  if (props.localLensData?.geo_signal === undefined) {
    return null;
  }
  return (
    <Badge
      variant="outline"
      className="mt-3 rounded-full border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground"
    >
      {props.localLensData.geo_signal.label}
    </Badge>
  );
};

const CollapsedLensBriefMetadata = (props: Readonly<CollapsedLensBriefProps>) => {
  const { localLensData, selectedCountryMeta } = props;
  const matchingStrategy = localLensData?.matching_strategy;
  const latestArticle = selectedCountryMeta?.latest_article;
  return (
    <div className="space-y-3">
      {hasText(matchingStrategy) && (
        <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
          Match: {matchingStrategy.replaceAll("_", " ")}
        </p>
      )}
      {hasText(latestArticle) && (
        <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
          Latest indexed: {formatArticleDateTime(latestArticle)}
        </p>
      )}
    </div>
  );
};

const CollapsedLensBrief = (props: Readonly<CollapsedLensBriefProps>) => (
  <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
    <CollapsedLensBriefHeader />
    <p className="text-sm leading-relaxed text-muted-foreground">
      {briefingDescriptionFor(props.selectedCountry, props.localLensData)}
    </p>
    <CollapsedLensBriefSignal localLensData={props.localLensData} />
    <CollapsedLensBriefMetadata
      localLensData={props.localLensData}
      selectedCountry={props.selectedCountry}
      selectedCountryMeta={props.selectedCountryMeta}
    />
  </div>
);

interface CollapsedSpotlightImageProps {
  readonly article: NewsArticle;
}

const CollapsedSpotlightTitle = (props: Readonly<CollapsedSpotlightImageProps>) => (
  <div className="absolute bottom-2 left-2 right-2">
    <h4 className="font-serif text-sm font-medium leading-tight text-foreground drop-shadow-md">
      {props.article.title}
    </h4>
  </div>
);

const CollapsedSpotlightImage = (props: Readonly<CollapsedSpotlightImageProps>) => {
  if (!isUsableImage(props.article.image)) {
    return null;
  }
  return (
    <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-lg border border-white/10">
      <SafeImage
        src={props.article.image}
        className="h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105"
        alt="Lead"
        fill
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <CollapsedSpotlightTitle article={props.article} />
    </div>
  );
};

export { CollapsedLensBrief, CollapsedSpotlightImage };
