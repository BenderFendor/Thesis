import { redirect } from "next/navigation";

export default function SourcesDebugRedirectPage() {
  redirect("/debug?tab=sources");
}
