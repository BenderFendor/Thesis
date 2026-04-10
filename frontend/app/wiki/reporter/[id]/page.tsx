"use client";

import { useParams } from "next/navigation";
import { ReporterWikiView } from "./reporter-wiki-view";

export default function ReporterProfilePage() {
  const params = useParams();
  return <ReporterWikiView reporterId={Number(params.id)} />;
}
