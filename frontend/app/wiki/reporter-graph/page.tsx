import type { Metadata } from "next";

import { ReporterGraphWorkspace } from "./reporter-graph-workspace";

export const metadata: Metadata = {
  title: "Reporter Network",
};

export default function ReporterGraphPage() {
  return <ReporterGraphWorkspace />;
}
