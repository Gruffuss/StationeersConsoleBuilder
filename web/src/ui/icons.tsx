import type { ReactNode } from 'react'

export type IconName = 'select' | 'points' | 'pen' | 'path' | 'rect' | 'ellipse' | 'polygon' | 'line' | 'text' | 'image' | 'gradient'
  | 'add' | 'remove' | 'close' | 'chevron-down' | 'chevron-right' | 'chevron-up' | 'play' | 'stop' | 'export' | 'download' | 'upload'
  | 'eye' | 'eye-off' | 'lock' | 'unlock' | 'group' | 'widget' | 'page' | 'detach' | 'trash' | 'more' | 'reset' | 'copy' | 'link'
  | 'code' | 'check' | 'warn' | 'info' | 'file' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down'
  | 'align-left' | 'align-centre' | 'align-right' | 'align-top' | 'align-middle' | 'align-bottom' | 'distribute-h' | 'distribute-v'

const shapes: Record<IconName, ReactNode> = {
  select: <path d="M6 3l12 9-5.5 1L15 19.5l-2.2 1-2.6-6.4L6 18z" fill="currentColor"/>,
  points: <><path d="M4 18L12 6l8 12"/><rect x="2" y="16" width="4" height="4"/><rect x="10" y="4" width="4" height="4"/><rect x="18" y="16" width="4" height="4"/></>,
  pen: <><path d="M3 21l3.5-9.5L15 3l6 6-8.5 8.5z"/><path d="M3 21l6.4-6.4"/><circle cx="11" cy="13" r="1.6"/></>,
  path: <path d="M4 18c2.5-7 5-9 8-6s5.5 1 8-6"/>,
  rect: <rect x="4" y="6" width="16" height="12" rx="1"/>,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6.5"/>,
  polygon: <path d="M12 3.5l8 6-3 9.5H7l-3-9.5z"/>,
  line: <path d="M5 19L19 5"/>,
  text: <path d="M5 7V5h14v2M12 5v14M9 19h6"/>,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="1"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-9.5 8"/></>,
  gradient: <><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M7 17L17 7"/><circle cx="7" cy="17" r="1.6" fill="currentColor"/><circle cx="17" cy="7" r="1.6"/></>,
  add: <path d="M12 5v14M5 12h14"/>,
  remove: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-down': <path d="M7 10l5 5 5-5"/>,
  'chevron-right': <path d="M10 7l5 5-5 5"/>,
  'chevron-up': <path d="M7 14l5-5 5 5"/>,
  play: <path d="M8 5.5l11 6.5-11 6.5z"/>,
  stop: <rect x="5" y="5" width="14" height="14" />,
  export: <path d="M14 3h7v7M21 3L11 13M10 5H4v15h15v-6"/>,
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v5h16v-5" />,
  eye: <><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/></>,
  'eye-off': <><path d="M3 3l18 18M9 5c6-2 11 4 13 7l-3 4M15 19C9 21 4 15 2 12l3-4" /><path d="M10 10a3 3 0 004 4" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 018 0v3"/></>,
  unlock: <><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 017.7-1.5"/></>,
  group: <rect x="3.5" y="3.5" width="17" height="17" rx="1" strokeDasharray="3 2.5"/>,
  widget: <path d="M12 2.5l3.5 3.5L12 9.5 8.5 6zM12 14.5l3.5 3.5-3.5 3.5L8.5 18zM6 8.5L9.5 12 6 15.5 2.5 12zM18 8.5l3.5 3.5-3.5 3.5-3.5-3.5z"/>,
  page: <path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>,
  detach: <path d="M9.5 14.5l-2.2 2.2a3 3 0 01-4.2-4.2l2.2-2.2M14.5 9.5l2.2-2.2a3 3 0 014.2 4.2l-2.2 2.2M8 3v3M3 8h3M16 21v-3M21 16h-3"/>,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>,
  more: <><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/></>,
  reset: <path d="M4 12a8 8 0 102.4-5.7L4 8.5M4 4v4.5h4.5"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/></>,
  link: <path d="M9 15l6-6M8 13l-3 3a3 3 0 004 4l4-4M11 8l4-4a3 3 0 014 4l-3 3" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>,
  check: <path d="M5 12l5 5 9-10"/>,
  warn: <><path d="M12 3L2 21h20zM12 9v5" /><circle cx="12" cy="18" r="0.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7" r="0.5" /></>,
  file: <path d="M5 2h9l5 5v15H5zM14 2v6h5" />,
  'pan-left': <path d="M19 12H5M10 7l-5 5 5 5"/>,
  'pan-right': <path d="M5 12h14M14 7l5 5-5 5"/>,
  'pan-up': <path d="M12 19V5M7 10l5-5 5 5"/>,
  'pan-down': <path d="M12 5v14M7 14l5 5 5-5"/>,
  'align-left': <><path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx=".5"/><rect x="7" y="14" width="7" height="4" rx=".5"/></>,
  'align-centre': <><path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx=".5"/><rect x="8" y="14" width="8" height="4" rx=".5"/></>,
  'align-right': <><path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx=".5"/><rect x="10" y="14" width="7" height="4" rx=".5"/></>,
  'align-top': <><path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx=".5"/><rect x="14" y="7" width="4" height="7" rx=".5"/></>,
  'align-middle': <><path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx=".5"/><rect x="14" y="8" width="4" height="8" rx=".5"/></>,
  'align-bottom': <><path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx=".5"/><rect x="14" y="10" width="4" height="7" rx=".5"/></>,
  'distribute-h': <><path d="M4 3v18M20 3v18"/><rect x="9.5" y="7" width="5" height="10" rx=".5"/></>,
  'distribute-v': <><path d="M3 4h18M3 20h18"/><rect x="7" y="9.5" width="10" height="5" rx=".5"/></>,
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={`ic ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>
}
