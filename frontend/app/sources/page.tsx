"use client";

import { redirect } from "next/navigation";

export default function SourcesRedirectPage() {
  redirect("/debug?tab=sources");
}
