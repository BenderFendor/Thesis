"use client";

import { SourceWikiView } from "./source-wiki-view";
import { useParams } from "next/navigation";

const SourceWikiPage = () => {
  const params = useParams();
  return <SourceWikiView sourceName={decodeURIComponent(String(params.sourceName))} />;
};

export default SourceWikiPage;
