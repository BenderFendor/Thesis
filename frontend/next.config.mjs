import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = import.meta.dirname,

/**
 * Next.js configuration for Scoop news reader
 *
 * @type {import('next').NextConfig}
 */
 nextConfig = {
  turbopack: {
    root: __dirname,
  },

  // Images are served via external image proxy (cloudinary/imgproxy)
  // No built-in optimization needed
  images: {
    remotePatterns: [
      {
        hostname: '**',
        protocol: 'https',
      },
      {
        hostname: '**',
        protocol: 'http',
      },
    ],
    unoptimized: true,
  },

  // Standalone output for minimal container image size
  // Only includes necessary runtime files, reduces deployment size by ~70%
  output: 'standalone',
}

export default nextConfig
