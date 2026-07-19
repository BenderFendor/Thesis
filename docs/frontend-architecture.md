# Frontend architecture and interaction rules

The frontend is a Next.js App Router application. Route files should coordinate data and page-level state; reusable UI and interaction logic should live under `frontend/components`, hooks under `frontend/hooks`, and pure state or formatting utilities under `frontend/lib` or a component-local module.

## Navigation architecture

The desktop workspace navigation is split into small pieces:

- `components/global-navigation.tsx` composes the sidebar and owns routing, persistence, and view synchronization.
- `components/navigation/navigation-config.ts` is the single source of truth for labels, icons, route matching, and view metadata.
- `components/navigation/navigation-state.ts` contains pure URL builders and storage keys.
- `components/navigation/sidebar-navigation-item.tsx` renders accessible link and button variants.
- `components/navigation/sidebar-section.tsx` provides consistent grouping and labels.
- `components/navigation/workspace-search.tsx` owns search input state and form behavior.

Do not add route-specific conditionals directly to the JSX when a navigation definition or matcher can express the same behavior.

## UI and UX rules

1. Every interaction must work with keyboard focus and without hover.
2. Collapsed controls need an accessible name and a visible focus state.
3. View state that users may bookmark or share belongs in the URL.
4. Route files should not duplicate navigation labels, icons, or active-state logic.
5. Global body typography stays neutral. Reading-size typography belongs to `.reading-prose` or another explicit content surface.
6. Respect `prefers-reduced-motion`; motion must not be required to understand state.
7. Empty, loading, and error states remain visible and actionable.

## Verification

Run these checks after frontend changes:

```bash
npm --prefix frontend run lint
npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit
npm --prefix frontend test -- --runInBand
npm --prefix frontend run build
```

Navigation changes should include tests for route selection, URL synchronization, search submission, and active-route semantics.
