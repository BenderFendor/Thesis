'use client'

import type { FunctionComponent, ReactElement } from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

interface ThemeProviderWrapperProps {
  readonly attribute?: 'class'
  readonly children: Readonly<ReactElement>
  readonly defaultTheme?: string
  readonly disableTransitionOnChange?: boolean
  readonly enableSystem?: boolean
}

const ThemeProvider: FunctionComponent<Readonly<ThemeProviderWrapperProps>> = (props) => {
  const {
    children,
    enableSystem,
    disableTransitionOnChange,
    defaultTheme,
    attribute,
  } = props

  return (
    <NextThemesProvider
      enableSystem={enableSystem}
      disableTransitionOnChange={disableTransitionOnChange}
      defaultTheme={defaultTheme}
      attribute={attribute}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
