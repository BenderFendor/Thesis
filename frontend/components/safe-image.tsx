"use client";

import { DEFAULT_ARTICLE_IMAGE, isUsableImage } from "@/lib/article-image";
import { useCallback, useState } from "react";
import Image from "next/image";

interface SafeImageProps {
  readonly alt: string;
  readonly className?: string;
  readonly fallbackSrc?: string;
  readonly fill?: boolean;
  readonly height?: ImageDimension;
  readonly sizes?: string;
  readonly src?: string | null;
  readonly unoptimized?: boolean;
  readonly width?: ImageDimension;
}

type ImageDimension = number | `${number}`;

const resolveSafeImageSource = (src: string | null | undefined, fallbackSrc: string): string => {
  if (isUsableImage(src)) {
    return src;
  }
  return fallbackSrc;
};
const resolveRenderedImageSource = (
  failedSrc: string | undefined,
  resolvedSrc: string,
  fallbackSrc: string,
): string => {
  if (failedSrc === resolvedSrc) {
    return fallbackSrc;
  }
  return resolvedSrc;
};

const SafeImage = ({
  src,
  alt,
  fallbackSrc = DEFAULT_ARTICLE_IMAGE,
  unoptimized = true,
  className,
  fill,
  height,
  sizes,
  width,
}: Readonly<SafeImageProps>) => {
  const resolvedSrc = resolveSafeImageSource(src, fallbackSrc),
    [failedSrc, setFailedSrc] = useState<string>(),
    sourceForRender = resolveRenderedImageSource(failedSrc, resolvedSrc, fallbackSrc),
    sourceRenderErrorHandler = useCallback(() => {
      setFailedSrc(resolvedSrc);
    }, [resolvedSrc]);

  return (
    <Image
      alt={alt}
      className={className}
      fill={fill}
      height={height}
      onError={sourceRenderErrorHandler}
      sizes={sizes}
      src={sourceForRender}
      unoptimized={unoptimized}
      width={width}
    />
  );
};

export { SafeImage };
