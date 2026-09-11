"use client";
import { hasText } from "@/lib/utils";

import { OrganizationWikiView } from "./organization-wiki-view";
import { useParams } from "next/navigation";

const OrganizationProfilePage = () => {
  const params = useParams();
  const rawId = (() => {
  if (Array.isArray(params.id)) {
    return params.id[0];
  }
  return params.id;
})();
  const entityId = (() => {
  if (hasText(rawId)) {
    return `organization:${decodeURIComponent(rawId)}`;
  }
  return "";
})();
  return <OrganizationWikiView entityId={entityId} />;
};

export default OrganizationProfilePage;
