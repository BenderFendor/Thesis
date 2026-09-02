"use client"

import { useCallback, useState } from "react"
import Image from "next/image"

interface SafeImageProps {
  readonly alt: string
  readonly className?: string
  readonly fallbackSrc?: string
  readonly fill?: boolean
  readonly height?: ImageDimension
  readonly sizes?: string
  readonly src?: string | null
  readonly unoptimized?: boolean
  readonly width?: ImageDimension
}

type ImageDimension = number | `${number}`

const EMPTY_STRING_LENGTH = 0,

 SafeImage = ({
  src,
  alt,
  fallbackSrc = "/placeholder.svg",
  unoptimized = true,
  className,
  fill,
  height,
  sizes,
  width,
}: Readonly<SafeImageProps>) => {
  const resolvedSrc = resolveImageSource(src, fallbackSrc),
   [failedSrc, setFailedSrc] = useState<string>(),
   sourceForRender = resolveFailedImageSource(resolvedSrc, failedSrc, fallbackSrc),
   sourceRenderErrorHandler = useCallback(() => {
    setFailedSrc(resolvedSrc)
  }, [resolvedSrc])

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
  )
},

 resolveFailedImageSource = (
  resolvedSrc: string,
  failedSrc: string | undefined,
  fallbackSrc: string,
): string => {
  if (failedSrc === resolvedSrc) {
    return fallbackSrc
  }

  return resolvedSrc
},

resolveImageSource = (src: string | null | undefined, fallbackSrc: string): string => {
  const candidate = src ?? fallbackSrc
  if (candidate.trim().length === EMPTY_STRING_LENGTH) {
    return fallbackSrc
  }

  return candidate
}

export { SafeImage }
