"use client";

import { BookOpen, Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { SafeImage } from "@/components/safe-image";
import type { NewsArticle } from "../lib/article-detail-modal-data";
import { useCallback } from "react";

type PropagationClickEvent = Readonly<{ stopPropagation: () => void }>;

const ModalHeroSourceLinks = ({
  article,
  onOpenSourceWiki,
  onClose,
}: Readonly<{
  article: NewsArticle;
  onOpenSourceWiki: () => void;
  onClose: () => void;
}>) => {
  const handleCloseLinkClick = useCallback(
    (event: PropagationClickEvent): void => {
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );
  const handleSourceClick = useCallback(
    (event: PropagationClickEvent): void => {
      event.stopPropagation();
      onOpenSourceWiki();
    },
    [onOpenSourceWiki],
  );
  return (
    <>
      <button
        type="button"
        onClick={handleSourceClick}
        className="font-medium transition-colors hover:text-primary hover:underline"
      >
        {article.source}
      </button>
      <Link href={`/source/${encodeURIComponent(article.sourceId)}`} className="text-muted-foreground transition-colors hover:text-primary" onClick={handleCloseLinkClick} title="Open source page"><LinkIcon className="h-3.5 w-3.5" /></Link>
      <Link href={`/wiki/source/${encodeURIComponent(article.source)}`} className="text-muted-foreground transition-colors hover:text-primary" onClick={handleCloseLinkClick} title="View wiki profile"><BookOpen className="h-3.5 w-3.5" /></Link>
    </>
  );
};

const ModalHeroVisual = ({ image }: Readonly<{ image: string | undefined }>) => {
  if (image === undefined) {
    return <div className="editorial-modal-fallback absolute inset-0" />;
  }
  return (
    <>
      <SafeImage
        src={image}
        alt=""
        fill
        sizes="100vw"
        className="h-full w-full object-cover opacity-70"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
    </>
  );
};

export { ModalHeroSourceLinks, ModalHeroVisual };
