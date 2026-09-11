import { Bookmark, Heart, Inbox, List, Newspaper, Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HighlightsView } from "@/components/highlights-view";
import {
  ArticleList,
  EmptyStateCard,
  SavedShelfCard,
} from "@/app/saved/saved-workspace-article-view";
import {
  DigestPanel,
  LoadingState,
  QueueTab,
  SavedSidebar,
} from "@/app/saved/saved-workspace-queue-view";
import { tagSavedArticles } from "@/app/saved/saved-workspace-helpers";
import type {
  ControllerProps,
  SavedTabProps,
  WorkspaceTabDefinition,
} from "@/app/saved/saved-workspace-types";

const AllSavedTab = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  if (controller.loading) {
    return <LoadingState label="Loading saved articles..." />;
  }
  if (controller.allSavedArticles.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <EmptyStateCard
          cardClassName="lg:col-span-2"
          icon={Inbox}
          title="No saved articles yet"
          description="Articles you bookmark or like will appear here."
          showBrowseLink
        />
        <SavedShelfCard controller={controller} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ArticleList articles={controller.allSavedArticles} controller={controller} />
      </div>
      <SavedSidebar controller={controller} />
    </div>
  );
};

const SavedTab = (props: Readonly<SavedTabProps>): ReactElement => {
  const { articles, controller, description, icon, kind, title } = props;
  if (controller.loading) {
    return <LoadingState label={`Loading ${title.toLowerCase()}...`} />;
  }
  if (articles.length === 0) {
    return (
      <EmptyStateCard
        icon={icon}
        title={`No ${title.toLowerCase()} yet`}
        description={description}
        showBrowseLink
      />
    );
  }
  return <ArticleList articles={tagSavedArticles(articles, kind)} controller={controller} />;
};

const HighlightsHeader = (props: Readonly<{ count: number }>): ReactElement => (
  <div className="flex items-center justify-between gap-3">
    <HighlightsTitle />
    <Badge className="px-3 py-1 text-base">{props.count}</Badge>
  </div>
);

const HighlightsTitle = (): ReactElement => (
  <div>
    <h2 className="font-serif text-xl font-bold">Highlights And Notes</h2>
    <p className="text-sm text-muted-foreground">
      Review saved passages across articles and keep the reader workflow centered here.
    </p>
  </div>
);

const HighlightsCard = (): ReactElement => (
  <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
    <CardContent className="p-6">
      <HighlightsView />
    </CardContent>
  </Card>
);

const SavedHighlightsTab = (props: Readonly<ControllerProps>): ReactElement => (
  <div className="space-y-6">
    <HighlightsHeader count={props.controller.highlightCount} />
    <HighlightsCard />
  </div>
);

const WorkspaceTabTrigger = (props: Readonly<WorkspaceTabDefinition>): ReactElement => {
  const Icon = props.icon;
  return (
    <TabsTrigger value={props.value} className="gap-2">
      <Icon className="h-4 w-4" />
      {props.label}
      <Badge variant="secondary">{props.count}</Badge>
    </TabsTrigger>
  );
};

const getWorkspaceTabs = (
  controller: ControllerProps["controller"],
): readonly WorkspaceTabDefinition[] => [
  {
    count: controller.allSavedArticles.length,
    icon: Newspaper,
    label: "All Saved",
    value: "all",
  },
  { count: controller.bookmarks.length, icon: Bookmark, label: "Bookmarks", value: "bookmarks" },
  { count: controller.likedArticles.length, icon: Heart, label: "Liked", value: "liked" },
  { count: controller.queuedArticles.length, icon: List, label: "Reading Queue", value: "queue" },
  { count: controller.highlightCount, icon: Sparkles, label: "Highlights", value: "highlights" },
];

const WorkspaceTabContents = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  return (
    <>
      <TabsContent value="all" className="mt-0">
        <DigestPanel controller={controller} />
        <AllSavedTab controller={controller} />
      </TabsContent>
      <TabsContent value="bookmarks" className="mt-0">
        <SavedTab
          articles={controller.bookmarks}
          controller={controller}
          description="Articles you bookmark will appear here."
          icon={Bookmark}
          kind="bookmark"
          title="Bookmarks"
        />
      </TabsContent>
      <TabsContent value="liked" className="mt-0">
        <SavedTab
          articles={controller.likedArticles}
          controller={controller}
          description="Articles you like will appear here."
          icon={Heart}
          kind="liked"
          title="Liked articles"
        />
      </TabsContent>
      <TabsContent value="queue" className="mt-0">
        <QueueTab controller={controller} />
      </TabsContent>
      <TabsContent value="highlights" className="mt-0">
        <SavedHighlightsTab controller={controller} />
      </TabsContent>
    </>
  );
};

const WorkspaceTabs = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  const handleTabChange = useCallback(
    (tab: string): void => {
      controller.setActiveTab(tab);
    },
    [controller],
  );
  return (
    <Tabs value={controller.activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="mb-6 border border-white/10 bg-[var(--news-bg-secondary)]">
        {getWorkspaceTabs(controller).map((tab) => (
          <WorkspaceTabTrigger
            key={tab.value}
            count={tab.count}
            icon={tab.icon}
            label={tab.label}
            value={tab.value}
          />
        ))}
      </TabsList>
      <WorkspaceTabContents controller={controller} />
    </Tabs>
  );
};

export { WorkspaceTabs };
