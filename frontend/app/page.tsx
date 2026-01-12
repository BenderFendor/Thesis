"use client"

export const dynamic = "force-dynamic";

import dynamicImport from "next/dynamic";

const NewsPage = dynamicImport(() => import("./page-client"), { ssr: false });

export default function Page() {
  return <NewsPage />;
}
