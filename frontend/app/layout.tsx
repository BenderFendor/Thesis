import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Instrument_Serif } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const instrumentSerif = Instrument_Serif({
  weight: '400',
  variable: '--font-instrument-serif',
  subsets: ['latin'],
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
      <body className={`font-sans text-white ${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable}`} style={{ backgroundColor: 'var(--news-bg-primary)' }}>
        <div className="min-h-screen" style={{ background: 'linear-gradient(to bottom, var(--news-bg-primary), var(--news-bg-secondary))' }}>
          {children}
        </div>
        <Analytics />
      </body>
    </html>
  )
}
