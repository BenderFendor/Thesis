import type { ReactElement } from "react";
import { useCallback } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { hasText } from "@/lib/utils";
import {
  DEFAULT_VISIBLE_PER_LANE,
  EMPTY_BLINDSPOT_CARDS,
  LANE_ANIMATE,
  LANE_INITIAL,
  LANE_TRANSITION,
  displayPoleLabel,
} from "@/components/blindspot-view-helpers";
import { LeadStory, MobileBlindspotTile, StoryRow } from "@/components/blindspot-view-story-cards";
import type {
  BlindspotLaneCardsProps,
  BlindspotLaneSectionProps,
  BlindspotLaneSectionsProps,
  ReadonlyBlindspotCard,
} from "@/components/blindspot-view-types";

const getVisibleCount = (expanded: boolean, cardCount: number): number => {
  if (expanded) {
    return cardCount;
  }
  return DEFAULT_VISIBLE_PER_LANE;
};

const getResponsiveTextClassName = (mobileText?: string): string => {
  if (hasText(mobileText)) {
    return "hidden lg:inline";
  }
  return "";
};

const LaneTitle = (props: Readonly<{ mobile?: string; title: string }>): ReactElement => (
  <h3 className="font-serif text-xl font-medium text-foreground/90 text-balance lg:text-3xl">
    {hasText(props.mobile) && <span className="lg:hidden">{props.mobile}</span>}
    <span className={getResponsiveTextClassName(props.mobile)}>{props.title}</span>
  </h3>
);

const LaneSubtitle = (props: Readonly<{ mobile?: string; subtitle: string }>): ReactElement => (
  <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/40 lg:text-[10px] lg:tracking-widest">
    {hasText(props.mobile) && <span className="lg:hidden">{props.mobile}</span>}
    <span className={getResponsiveTextClassName(props.mobile)}>{props.subtitle}</span>
  </p>
);

const LaneHeader = (
  props: Readonly<{
    accentClass: string;
    subtitle: string;
    subtitleMobile?: string;
    title: string;
    titleMobile?: string;
  }>,
): ReactElement => (
  <div className={`space-y-1 border-l-2 ${props.accentClass} pl-3 lg:space-y-2 lg:pl-6`}>
    <LaneTitle mobile={props.titleMobile} title={props.title} />
    <LaneSubtitle mobile={props.subtitleMobile} subtitle={props.subtitle} />
  </div>
);

const LaneCardStack = (props: Readonly<BlindspotLaneCardsProps>): ReactElement => (
  <div className="flex flex-col space-y-3 lg:space-y-8">
    <BlindspotLaneCards
      cards={props.cards}
      emptyLabel={props.emptyLabel}
      expanded={props.expanded}
      onExpand={props.onExpand}
      onOpen={props.onOpen}
      poleLabels={props.poleLabels}
    />
  </div>
);

const BlindspotLaneSection = (props: Readonly<BlindspotLaneSectionProps>): ReactElement => {
  const { expandedLanes, laneId, laneMap, onExpandLane, onOpenCard, poleLabels } = props;
  const handleExpand = useCallback(() => {
    onExpandLane(laneId);
  }, [laneId, onExpandLane]);
  const cards = laneMap.get(laneId) ?? EMPTY_BLINDSPOT_CARDS;
  return (
    <motion.section
      initial={LANE_INITIAL}
      animate={LANE_ANIMATE}
      transition={LANE_TRANSITION}
      className="flex flex-col space-y-3 lg:space-y-8"
    >
      <LaneHeader
        accentClass={props.accentClass}
        subtitle={props.subtitle}
        subtitleMobile={props.subtitleMobile}
        title={props.title}
        titleMobile={props.titleMobile}
      />
      <LaneCardStack
        cards={cards}
        emptyLabel={props.emptyLabel}
        expanded={expandedLanes[laneId] ?? false}
        onExpand={handleExpand}
        onOpen={onOpenCard}
        poleLabels={poleLabels}
      />
    </motion.section>
  );
};

const BlindspotLaneSections = (props: Readonly<BlindspotLaneSectionsProps>): ReactElement => {
  const { expandedLanes, laneMap, onExpandLane, onOpenCard, poleLabels } = props;
  return (
    <div className="grid gap-7 xl:grid-cols-3 xl:gap-12">
      <BlindspotLaneSection
        accentClass="border-red-500/40"
        emptyLabel="No significant blindspots detected"
        expandedLanes={expandedLanes}
        laneId="pole_b"
        laneMap={laneMap}
        onExpandLane={onExpandLane}
        onOpenCard={onOpenCard}
        poleLabels={poleLabels}
        subtitle={`Reported primarily by ${props.poleLabels.pole_b.toLowerCase()} outlets`}
        subtitleMobile={`Reported primarily by ${displayPoleLabel(props.poleLabels.pole_b).toLowerCase()} outlets`}
        title={`Missed by ${props.poleLabels.pole_a}`}
        titleMobile={`Missed by ${displayPoleLabel(props.poleLabels.pole_a)}`}
      />
      <BlindspotLaneSection
        accentClass="border-zinc-500/40"
        emptyLabel="No balanced signals detected"
        expandedLanes={expandedLanes}
        laneId="shared"
        laneMap={laneMap}
        onExpandLane={onExpandLane}
        onOpenCard={onOpenCard}
        poleLabels={poleLabels}
        subtitle="Stories with consensus or neutral coverage"
        title="Balanced & Center"
      />
      <BlindspotLaneSection
        accentClass="border-cyan-500/40"
        emptyLabel="No significant blindspots detected"
        expandedLanes={expandedLanes}
        laneId="pole_a"
        laneMap={laneMap}
        onExpandLane={onExpandLane}
        onOpenCard={onOpenCard}
        poleLabels={poleLabels}
        subtitle={`Reported primarily by ${props.poleLabels.pole_a.toLowerCase()} outlets`}
        subtitleMobile={`Reported primarily by ${displayPoleLabel(props.poleLabels.pole_a).toLowerCase()} outlets`}
        title={`Missed by ${props.poleLabels.pole_b}`}
        titleMobile={`Missed by ${displayPoleLabel(props.poleLabels.pole_b)}`}
      />
    </div>
  );
};

const MobileLaneGrid = (
  props: Readonly<{
    cards: readonly ReadonlyBlindspotCard[];
    onOpen: (card: ReadonlyBlindspotCard) => void;
    poleLabels: BlindspotLaneSectionsProps["poleLabels"];
  }>,
): ReactElement => (
  <div className="grid grid-cols-2 gap-2 lg:hidden">
    {props.cards.map((card) => (
      <MobileBlindspotTile
        key={card.cluster_id}
        card={card}
        laneId={card.lane}
        poleLabels={props.poleLabels}
        onOpen={props.onOpen}
      />
    ))}
  </div>
);

const DesktopLaneStories = (
  props: Readonly<{
    leadCard: ReadonlyBlindspotCard;
    listCards: readonly ReadonlyBlindspotCard[];
    onOpen: (card: ReadonlyBlindspotCard) => void;
    poleLabels: BlindspotLaneSectionsProps["poleLabels"];
  }>,
): ReactElement => (
  <div className="hidden lg:flex lg:flex-col lg:space-y-8">
    <LeadStory
      card={props.leadCard}
      laneId={props.leadCard.lane}
      poleLabels={props.poleLabels}
      onOpen={props.onOpen}
    />
    <div className="flex flex-col gap-3">
      {props.listCards.map((card) => (
        <StoryRow
          key={card.cluster_id}
          card={card}
          poleLabels={props.poleLabels}
          onOpen={props.onOpen}
        />
      ))}
    </div>
  </div>
);

const ShowMoreButton = (
  props: Readonly<{ hiddenCount: number; onClick: () => void }>,
): ReactElement => (
  <Button
    type="button"
    variant="outline"
    onClick={props.onClick}
    className="w-full rounded-xl border-white/10 bg-white/[0.02] py-6 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground"
  >
    Show {props.hiddenCount} more blindspots
  </Button>
);

const BlindspotLaneCards = (props: Readonly<BlindspotLaneCardsProps>): ReactElement => {
  const leadCard = props.cards[0];
  const visibleCount = getVisibleCount(props.expanded, props.cards.length);
  const listCards = props.cards.slice(1, visibleCount);
  const hiddenCount = Math.max(props.cards.length - visibleCount, 0);
  if (leadCard === undefined) {
    return (
      <div className="rounded-2xl bg-white/[0.01] py-12 text-center text-xs font-mono text-muted-foreground/20">
        {props.emptyLabel}
      </div>
    );
  }
  return (
    <>
      <MobileLaneGrid
        cards={props.cards.slice(0, visibleCount)}
        onOpen={props.onOpen}
        poleLabels={props.poleLabels}
      />
      <DesktopLaneStories
        leadCard={leadCard}
        listCards={listCards}
        onOpen={props.onOpen}
        poleLabels={props.poleLabels}
      />
      {hiddenCount > 0 && <ShowMoreButton hiddenCount={hiddenCount} onClick={props.onExpand} />}
    </>
  );
};

export { BlindspotLaneSections };
