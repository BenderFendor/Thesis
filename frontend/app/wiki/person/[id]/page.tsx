"use client";

import { PersonWikiView } from "./person-wiki-view";
import { useParams } from "next/navigation";

export default function PersonProfilePage() {
  const params = useParams(),
   rawId = Array.isArray(params.id) ? params.id[0] : params.id,
   entityId = rawId ? `person:${decodeURIComponent(rawId)}` : "";
  return <PersonWikiView entityId={entityId} />;
}
