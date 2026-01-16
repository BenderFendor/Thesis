import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Instrument_Serif, Inter } from 'next/font/google'
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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`font-sans text-foreground ${GeistSans.variable} ${GeistMono.variable} ${inter.variable} ${instrumentSerif.variable}`} style={{ backgroundColor: 'var(--news-bg-primary)' }}>
        <Providers>
          <div className="min-h-screen" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  )
}
