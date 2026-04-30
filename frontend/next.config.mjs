import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Next.js configuration for Scoop news reader
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },

  // Images are served via external image proxy (cloudinary/imgproxy)
  // No built-in optimization needed
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  // Standalone output for minimal container image size
  // Only includes necessary runtime files, reduces deployment size by ~70%
  output: 'standalone',
}

export default nextConfig
