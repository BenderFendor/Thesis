import './globals.css'
import { Instrument_Serif as instrumentSerifFont, Outfit as outfitFont } from 'next/font/google'
import { BrowserTelemetry } from '@/components/observability/browser-telemetry'
import { GeistMono } from 'geist/font/mono'
import type { Metadata } from 'next'
import { Providers } from './providers'
import Script from 'next/script'
import { buildAppearanceBootstrapScript } from '@/lib/appearance-settings'

// Next's font loader requires one module-scope declaration per font call.
const instrumentSerif = instrumentSerifFont({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-instrument-serif',
  weight: '400',
})

const outfit = outfitFont({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-outfit',
})

const metadata: Metadata = {
  description: 'A multi-perspective news aggregation platform with global coverage',
  icons: {
    icon: '/favicon.svg',
  },
  title: 'Scoop - Multi-perspective News',
}

const isDevelopment = globalThis.process.env.NODE_ENV === 'development'

const RootLayout = ({ children }: Readonly<{ readonly children: React.ReactNode }>) => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="appearance-bootstrap" strategy="beforeInteractive">
          {buildAppearanceBootstrapScript()}
        </Script>
        {isDevelopment && (
          <Script
            src="https://unpkg.com/react-grab@0.1.48/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body
        className={`font-sans text-foreground antialiased ${GeistMono.variable} ${outfit.variable} ${instrumentSerif.variable}`}
        suppressHydrationWarning
      >
        <Providers>
          <BrowserTelemetry />
          <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
            {children}
          </div>
        </Providers>
      </body>
    </html>
)

export { metadata }
export default RootLayout
