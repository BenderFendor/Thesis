"use client";

import dynamic from "next/dynamic";

import { GlobalNavigation } from "@/components/global-navigation";

const ReporterGraphCanvas = dynamic(
  () => import("./reporter-graph-canvas"),
  { ssr: false },
);

export function ReporterGraphWorkspace() {
  return (
    <div className="flex min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <GlobalNavigation />
      <main className="relative h-screen min-w-0 flex-1">
        <ReporterGraphCanvas />
      </main>
    </div>
  );
}
