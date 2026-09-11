"use client";

import { ReporterWikiView } from "./reporter-wiki-view";
import { useParams } from "next/navigation";

const ReporterProfilePage = () => {
  const params = useParams();
  return <ReporterWikiView reporterId={Number(params.id)} />;
};

export default ReporterProfilePage;
