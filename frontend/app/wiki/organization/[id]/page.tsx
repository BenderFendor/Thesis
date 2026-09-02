"use client";

import { OrganizationWikiView } from "./organization-wiki-view";
import { useParams } from "next/navigation";

export default function OrganizationProfilePage() {
  const params = useParams(),
   rawId = Array.isArray(params.id) ? params.id[0] : params.id,
   entityId = rawId ? `organization:${decodeURIComponent(rawId)}` : "";
  return <OrganizationWikiView entityId={entityId} />;
}
