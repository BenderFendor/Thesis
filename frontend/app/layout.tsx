import type { Metadata } from 'next'
import Script from 'next/script'
import { GeistMono } from 'geist/font/mono'
import { Instrument_Serif, Outfit } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { BrowserTelemetry } from '@/components/observability/browser-telemetry'

const instrumentSerif = Instrument_Serif({
  weight: '400',
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  display: 'swap',
})

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Scoop - Multi-perspective News',
  description: 'A multi-perspective news aggregation platform with global coverage',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === 'development' ? (
          <Script
            src="https://unpkg.com/react-grab@0.1.48/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        ) : null}
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
}
