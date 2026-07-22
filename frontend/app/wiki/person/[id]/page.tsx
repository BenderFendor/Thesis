"use client";

import { useParams } from "next/navigation";
import { PersonWikiView } from "./person-wiki-view";

export default function PersonProfilePage() {
  const params = useParams();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const entityId = rawId ? `person:${decodeURIComponent(rawId)}` : "";
  return <PersonWikiView entityId={entityId} />;
}
