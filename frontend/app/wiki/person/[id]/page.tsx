"use client";
import { hasText } from "@/lib/utils";

import { PersonWikiView } from "./person-wiki-view";
import { useParams } from "next/navigation";

const PersonProfilePage = () => {
  const params = useParams();
  const rawId = (() => {
  if (Array.isArray(params.id)) {
    return params.id[0];
  }
  return params.id;
})();
  const entityId = (() => {
  if (hasText(rawId)) {
    return `person:${decodeURIComponent(rawId)}`;
  }
  return "";
})();
  return <PersonWikiView entityId={entityId} />;
};

export default PersonProfilePage;
