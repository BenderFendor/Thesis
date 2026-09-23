import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { debugArticleRowKey } from "./debug-dashboard-utils";
import { SnapshotCard } from "./debug-dashboard-primitives";
import { DEBUG_DRIFT_SAMPLE_LIMIT, EMPTY_DEBUG_LIST } from "./debug-dashboard-schemas";
import type {
  DebugDatabaseResponse,
  DebugStorageDrift,
  StorageSnapshotSectionProps,
} from "./debug-dashboard-types";

const getChromaId = (chromaId?: string | null): string => {
  if (chromaId === undefined || chromaId === null || chromaId === "") {
    return "missing";
  }
  return chromaId;
};

const getChromaLabel = (chromaId?: string | null): string => {
  if (chromaId === undefined || chromaId === null || chromaId === "") {
    return "(no chroma id)";
  }
  return chromaId;
};

const DriftMissingSamples = (
  props: DeepReadonly<{
    entries: NonNullable<DebugStorageDrift["missing_in_chroma"]>;
  }>,
) => {
  if (props.entries.length === 0) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold">Articles missing in Chroma</h3>
        <p className="text-muted-foreground text-xs">No gaps detected.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Articles missing in Chroma</h3>
      <ul className="space-y-1 text-xs">
        {props.entries.map((entry) => (
          <li
            key={debugArticleRowKey(entry.id, getChromaId(entry.chroma_id))}
            className="rounded bg-muted p-2"
          >
            #{entry.id} - {getChromaLabel(entry.chroma_id)}
          </li>
        ))}
      </ul>
    </div>
  );
};

const DriftDanglingSamples = (
  props: DeepReadonly<{
    ids: NonNullable<DebugStorageDrift["dangling_in_chroma"]>;
  }>,
) => {
  if (props.ids.length === 0) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold">Dangling Chroma IDs</h3>
        <p className="text-muted-foreground text-xs">No extra vectors detected.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Dangling Chroma IDs</h3>
      <ul className="space-y-1 text-xs">
        {props.ids.map((chromaId) => (
          <li key={chromaId} className="rounded bg-muted p-2 font-mono">
            {chromaId}
          </li>
        ))}
      </ul>
    </div>
  );
};

const DriftSamplesCard = (
  props: DeepReadonly<{ driftData: DebugStorageDrift | undefined }>,
) => {
  const danglingSamples =
    props.driftData?.dangling_in_chroma?.slice(0, DEBUG_DRIFT_SAMPLE_LIMIT) ?? EMPTY_DEBUG_LIST;
  const missingSamples =
    props.driftData?.missing_in_chroma?.slice(0, DEBUG_DRIFT_SAMPLE_LIMIT) ?? EMPTY_DEBUG_LIST;
  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Drift samples</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <DriftMissingSamples entries={missingSamples} />
        <DriftDanglingSamples ids={danglingSamples} />
      </CardContent>
    </Card>
  );
};

const formatPublishedDate = (publishedAt?: string | null): string => {
  if (publishedAt === undefined || publishedAt === null || publishedAt === "") {
    return "-";
  }
  return formatArticleDateTime(publishedAt);
};

const getEmbeddingMarker = (generated?: boolean | null): string => {
  if (generated === true) {
    return "";
  }
  return "—";
};

const PostgresArticleHeader = () => (
  <TableHeader>
    <TableRow>
      <TableHead>ID</TableHead>
      <TableHead>Source</TableHead>
      <TableHead>Title</TableHead>
      <TableHead>Published</TableHead>
      <TableHead>Embedding</TableHead>
    </TableRow>
  </TableHeader>
);

const PostgresArticleRow = (props: DeepReadonly<{ article: NonNullable<DebugDatabaseResponse["articles"]>[number] }>) => {
  const article = props.article;
  const hasChromaId =
    article.chroma_id !== undefined && article.chroma_id !== null && article.chroma_id !== "";
  return (
    <TableRow key={debugArticleRowKey(article.id, article.url)}>
      <TableCell className="font-mono text-xs">{article.id}</TableCell>
      <TableCell>{article.source}</TableCell>
      <TableCell>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {article.title}
        </a>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatPublishedDate(article.published_at)}
      </TableCell>
      <TableCell className="text-xs">
        {getEmbeddingMarker(article.embedding_generated)}{" "}
        {hasChromaId && (
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
            {article.chroma_id}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
};

const PostgresArticleRows = (
  props: DeepReadonly<{
    articles: readonly NonNullable<DebugDatabaseResponse["articles"]>[number][] | undefined;
  }>,
) => {
  if (props.articles === undefined) {
    return null;
  }
  return (
    <>
      {props.articles.map((article) => (
        <PostgresArticleRow key={debugArticleRowKey(article.id, article.url)} article={article} />
      ))}
    </>
  );
};

const PostgresArticlesTable = (props: DeepReadonly<{ dbData: DebugDatabaseResponse | undefined }>) => (
  <Table>
    <PostgresArticleHeader />
    <TableBody>
      <PostgresArticleRows articles={props.dbData?.articles} />
    </TableBody>
    <TableCaption>
      Showing {props.dbData?.returned ?? 0} / {props.dbData?.total ?? 0} rows
    </TableCaption>
  </Table>
);

const PostgresArticlesCard = (
  props: DeepReadonly<{ dbData: DebugDatabaseResponse | undefined }>,
) => (
  <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Postgres articles</CardTitle>
    </CardHeader>
    <CardContent>
      <PostgresArticlesTable dbData={props.dbData} />
    </CardContent>
  </Card>
);

const StorageDriftCard = (
  props: DeepReadonly<Pick<StorageSnapshotSectionProps, "driftStats">>,
) => (
  <SnapshotCard title="Storage Drift">
    <p>DB rows with embeddings: {props.driftStats?.database_with_embeddings ?? "-"}</p>
    <p>Chroma vectors: {props.driftStats?.vector_total_documents ?? "-"}</p>
    <p>Missing in Chroma: {props.driftStats?.missing_in_chroma_count ?? "-"}</p>
    <p>Dangling in Chroma: {props.driftStats?.dangling_in_chroma_count ?? "-"}</p>
  </SnapshotCard>
);

export {
  DriftSamplesCard,
  PostgresArticlesCard,
  StorageDriftCard,
};
