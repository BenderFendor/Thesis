"use client";

import { useParams } from "next/navigation";
import { SourceWikiView } from "./source-wiki-view";

export default function SourceWikiPage() {
  const params = useParams();
  return <SourceWikiView sourceName={decodeURIComponent(params.sourceName as string)} />;
}
