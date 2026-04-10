"use client"

import { useEffect, useState } from "react"
import Image, { type ImageProps } from "next/image"

type SafeImageProps = Omit<ImageProps, "src"> & {
  src?: string | null
  fallbackSrc?: string
}

export function SafeImage({
  src,
  alt,
  fallbackSrc = "/placeholder.svg",
  unoptimized = true,
  ...props
}: SafeImageProps) {
  const resolvedSrc = src && src.trim().length > 0 ? src : fallbackSrc
  const [currentSrc, setCurrentSrc] = useState(resolvedSrc)

  useEffect(() => {
    setCurrentSrc(resolvedSrc)
  }, [resolvedSrc])

  return (
    <Image
      {...props}
      alt={alt}
      src={currentSrc}
      unoptimized={unoptimized}
      onError={() => {
        if (currentSrc !== fallbackSrc) {
          setCurrentSrc(fallbackSrc)
        }
      }}
    />
  )
}
