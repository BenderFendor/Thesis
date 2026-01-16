/**
 * Next.js configuration for Scoop news reader
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Images are served via external image proxy (cloudinary/imgproxy)
  // No built-in optimization needed
  images: {
    unoptimized: true,
  },

  // Standalone output for minimal container image size
  // Only includes necessary runtime files, reduces deployment size by ~70%
  output: 'standalone',
}

export default nextConfig