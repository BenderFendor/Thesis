"use client";

import { DebugDashboard } from "./debug-dashboard";
import { Suspense } from "react";

const DEBUG_PAGE_FALLBACK = <div className="min-h-screen bg-background" />;

const DebugPage = () => (
  <Suspense fallback={DEBUG_PAGE_FALLBACK}>
    <DebugDashboard />
  </Suspense>
);

export default DebugPage;
