"use client";

import { useEffect } from "react";

export default function IntelligenceAtlasError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Intelligence Atlas route error", error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#080907] p-8 text-[#c9c3b6]">
      <div className="max-w-lg rounded-3xl border border-red-400/20 bg-red-950/20 p-8 text-center">
        <h1 className="font-serif text-3xl text-[#f0ede4]">The Atlas could not open</h1>
        <p className="mt-3 text-sm leading-relaxed">{error.message || "The route failed before the bounded graph could be rendered."}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-full border border-white/15 px-5 py-2 text-sm text-[#f0ede4] hover:border-[#d7b35f]/50"
        >
          Retry route
        </button>
      </div>
    </main>
  );
}
