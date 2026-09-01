import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = import.meta.dirname,

/**
 * Next.js configuration for Scoop news reader
 *
 * @type {import('next').NextConfig}
 */
 nextConfig = {
  // These ESM packages are imported by the real Jest component paths. Keep
  // Them in the Next transpilation set so tests exercise the shipped modules.
  transpilePackages: [
    'bail',
    'ccount',
    'character-entities',
    'character-entities-html4',
    'character-entities-legacy',
    'character-reference-invalid',
    'comma-separated-tokens',
    'd3-array',
    'd3-geo',
    'decode-named-character-reference',
    'devlop',
    'dequal',
    'estree-util-is-identifier-name',
    'escape-string-regexp',
    'hast-util-to-jsx-runtime',
    'hast-util-whitespace',
    'html-url-attributes',
    'inline-style-parser',
    'internmap',
    'is-alphabetical',
    'is-alphanumerical',
    'is-decimal',
    'is-hexadecimal',
    'is-plain-obj',
    'longest-streak',
    'markdown-table',
    'mdast-util-find-and-replace',
    'mdast-util-from-markdown',
    'mdast-util-gfm',
    'mdast-util-gfm-autolink-literal',
    'mdast-util-gfm-footnote',
    'mdast-util-gfm-strikethrough',
    'mdast-util-gfm-table',
    'mdast-util-gfm-task-list-item',
    'mdast-util-mdx-expression',
    'mdast-util-mdx-jsx',
    'mdast-util-mdxjs-esm',
    'mdast-util-phrasing',
    'mdast-util-to-hast',
    'mdast-util-to-markdown',
    'mdast-util-to-string',
    'micromark',
    'micromark-core-commonmark',
    'micromark-extension-gfm',
    'micromark-extension-gfm-autolink-literal',
    'micromark-extension-gfm-footnote',
    'micromark-extension-gfm-strikethrough',
    'micromark-extension-gfm-table',
    'micromark-extension-gfm-tagfilter',
    'micromark-extension-gfm-task-list-item',
    'micromark-factory-destination',
    'micromark-factory-label',
    'micromark-factory-space',
    'micromark-factory-title',
    'micromark-factory-whitespace',
    'micromark-util-character',
    'micromark-util-chunked',
    'micromark-util-classify-character',
    'micromark-util-combine-extensions',
    'micromark-util-decode-numeric-character-reference',
    'micromark-util-decode-string',
    'micromark-util-encode',
    'micromark-util-html-tag-name',
    'micromark-util-normalize-identifier',
    'micromark-util-resolve-all',
    'micromark-util-sanitize-uri',
    'micromark-util-subtokenize',
    'micromark-util-symbol',
    'micromark-util-types',
    'parse-entities',
    'property-information',
    'react-markdown',
    'remark-gfm',
    'remark-parse',
    'remark-rehype',
    'space-separated-tokens',
    'stringify-entities',
    'style-to-js',
    'style-to-object',
    'trim-lines',
    'trough',
    'unified',
    'unist-util-is',
    'unist-util-position',
    'unist-util-stringify-position',
    'unist-util-visit',
    'unist-util-visit-parents',
    'vfile',
    'vfile-message',
    'zwitch',
  ],
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
