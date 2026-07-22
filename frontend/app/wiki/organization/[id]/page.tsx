"use client";

import { useParams } from "next/navigation";
import { OrganizationWikiView } from "./organization-wiki-view";

export default function OrganizationProfilePage() {
  const params = useParams();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const entityId = rawId ? `organization:${decodeURIComponent(rawId)}` : "";
  return <OrganizationWikiView entityId={entityId} />;
}
