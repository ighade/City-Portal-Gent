/**
 * Kleur- en vormtokens van de site (frontend/src/tokens.css en app.css), licht en donker.
 */

export interface Palette {
  scheme: 'light' | 'dark'
  bg: string
  bgTint: string
  surface: string
  surface2: string
  surface3: string
  overlay: string
  ink: string
  ink2: string
  muted: string
  border: string
  borderStrong: string
  brand: string
  brandStrong: string
  brandInk: string
  brandSoft: string
  brandSoft2: string
  ring: string
  aurora: [string, string, string]
  ok: string
  okInk: string
  warn: string
  warnInk: string
  serious: string
  seriousInk: string
  crit: string
  critInk: string
  info: string
  infoInk: string
  neutralBadge: string
  c1: string
  grid: string
  axis: string
  /** De zes drukteniveaus (vrij … onbekend). */
  levelVrij: string
  levelRustig: string
  levelDruk: string
  levelBijnaVol: string
  levelVol: string
  levelOnbekend: string
  /** De kleurtrap van het drukterooster, stap 1 t/m 6. */
  heat: [string, string, string, string, string, string]
  lezLine: string
  lezFill: string
}

export const lightPalette: Palette = {
  scheme: 'light',
  bg: '#f7f8fa',
  bgTint: '#f1f3f6',
  surface: '#ffffff',
  surface2: '#f7f8fa',
  surface3: '#f1f3f6',
  overlay: 'rgba(16, 24, 40, 0.42)',
  ink: '#101828',
  ink2: '#475467',
  muted: '#667085',
  border: '#e4e7ec',
  borderStrong: '#d0d5dd',
  brand: '#4f46e5',
  brandStrong: '#4338ca',
  brandInk: '#ffffff',
  brandSoft: '#eef2ff',
  brandSoft2: '#e0e7ff',
  ring: 'rgba(79, 70, 229, 0.25)',
  aurora: ['#4f46e5', '#2a78d6', '#1baf7a'],
  ok: '#0ca30c',
  okInk: '#0a7d0a',
  warn: '#d98a00',
  warnInk: '#a86a00',
  serious: '#d5652f',
  seriousInk: '#b04e1f',
  crit: '#d03b3b',
  critInk: '#b52d2d',
  info: '#2a78d6',
  infoInk: '#1c5fae',
  neutralBadge: '#7d7d8a',
  c1: '#2a78d6',
  grid: '#e4e4ec',
  axis: '#c9c9d2',
  levelVrij: '#0ca30c',
  levelRustig: '#6aa84f',
  levelDruk: '#d98a00',
  levelBijnaVol: '#d5652f',
  levelVol: '#d03b3b',
  levelOnbekend: '#7d7d8a',
  heat: ['#eef2ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4338ca'],
  lezLine: '#e8590c',
  lezFill: 'rgba(255, 140, 0, 0.30)',
}

export const darkPalette: Palette = {
  scheme: 'dark',
  bg: '#0d1117',
  bgTint: '#151b23',
  surface: '#151b23',
  surface2: '#1b2330',
  surface3: '#222c3b',
  overlay: 'rgba(2, 6, 12, 0.62)',
  ink: '#e6edf3',
  ink2: '#b3bdc9',
  muted: '#8d96a5',
  border: '#262f3d',
  borderStrong: '#354051',
  brand: '#818cf8',
  brandStrong: '#a5b4fc',
  brandInk: '#0b1017',
  brandSoft: '#272b52',
  brandSoft2: '#313668',
  ring: 'rgba(129, 140, 248, 0.35)',
  aurora: ['#818cf8', '#3987e5', '#199e70'],
  ok: '#22c55e',
  okInk: '#4ade80',
  warn: '#fab219',
  warnInk: '#fac95a',
  serious: '#ec835a',
  seriousInk: '#f0a07f',
  crit: '#e05a5a',
  critInk: '#f07f7f',
  info: '#3987e5',
  infoInk: '#7db3ee',
  neutralBadge: '#9a9aa8',
  c1: '#3987e5',
  grid: '#26262f',
  axis: '#34343f',
  levelVrij: '#22c55e',
  levelRustig: '#7cb867',
  levelDruk: '#fab219',
  levelBijnaVol: '#ec835a',
  levelVol: '#e05a5a',
  levelOnbekend: '#9a9aa8',
  heat: ['#1b2136', '#252e57', '#33407f', '#4455ab', '#6172d8', '#94a3fb'],
  lezLine: '#ff922b',
  lezFill: 'rgba(255, 146, 43, 0.30)',
}

export const Palettes = { light: lightPalette, dark: darkPalette } as const

export const Radius = { xs: 6, sm: 8, md: 12, lg: 16, full: 999 } as const

export const Spacing = { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32, six: 64 } as const

export const MaxContentWidth = 800
