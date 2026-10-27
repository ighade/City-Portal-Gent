import Svg, { Path, Rect } from 'react-native-svg'

export type IconName = 'foot' | 'bike' | 'car' | 'transit' | 'route' | 'events' | 'friends' | 'info' | 'sun' | 'moon' | 'calendar' | 'locate'

const PATHS: Record<IconName, string> = {
  locate: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v3M12 19v3M2 12h3M19 12h3',
  foot: 'M13 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 21l2-6-2-2 1-5 3 2 2 3M11 13l-3 1',
  bike: 'M5.5 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12 18.5l-2-7h7M10.5 11.5 8 7H6M14 7h2',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 13h.01M17 13h.01',
  transit: 'M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM4 11h16M8 21l1.5-4M16 21l-1.5-4M8 14h.01M16 14h.01',
  route: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21ZM12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  events: 'M3 10h18M8 3v4M16 3v4',
  calendar: 'M3 10h18M8 3v4M16 3v4',
  friends: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
}

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {(name === 'events' || name === 'calendar') && <Rect x="3" y="5" width="18" height="16" rx="2" />}
      <Path d={PATHS[name]} />
    </Svg>
  )
}
