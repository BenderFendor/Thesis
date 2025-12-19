import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Instrument_Serif, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { Providers } from './providers'

const instrumentSerif = Instrument_Serif({
  weight: '400',
  variable: '--font-instrument-serif',
  subsets: ['latin'],
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Scoop - Multi-perspective News',
  description: 'A multi-perspective news aggregation platform with global coverage'
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@100..900&display=swap" rel="stylesheet" />
      </head>
      <body className={`font-sans text-foreground ${GeistSans.variable} ${GeistMono.variable} ${inter.variable} ${instrumentSerif.variable}`} style={{ backgroundColor: 'var(--news-bg-primary)' }}>
        <Providers>
          <div className="min-h-screen" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
            {children}
          </div>
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
