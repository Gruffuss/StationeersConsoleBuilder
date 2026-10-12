import type { ReactNode } from 'react'

const shapes: Record<string, ReactNode> = {
  alert: <><path d="M12 3L2 21h20zM12 9v5" /><circle cx="12" cy="18" r=".5" /></>,
  bar: <><rect x="3" y="8" width="18" height="8" rx="1" /><path d="M6 11h8v2H6z" /></>,
  button: <><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M8 12h8" /></>,
  duct: <path d="M3 8h7v8h11M3 12h3v8h15M14 3v9h7" strokeDasharray="3 2" />,
  eventlog: <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M6 7h2m3 0h7M6 12h2m3 0h7M6 17h2m3 0h7" /></>,
  gauge: <><path d="M4 18a9 9 0 1116 0M12 12l5-5M5 7l2 2M12 3v3M19 7l-2 2" /><circle cx="12" cy="12" r="2" /></>,
  glyph: <path d="M12 3l2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2-4.5-4.4 6.3-.9z" />,
  header: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 10h18M6 7.5h6" /></>,
  icon: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 7c-4 5-4 7-2 9 2 2 6 0 5-3l-3-6z" /></>,
  kvtable: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M12 4v16M3 9h18M3 15h18" /></>,
  light: <><circle cx="12" cy="12" r="5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  options: <><circle cx="5" cy="7" r="2" /><circle cx="5" cy="17" r="2" /><path d="M10 7h11M10 17h11" /></>,
  panel: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M6 7h8M6 11h12M6 15h12" /></>,
  readout: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M7 8h10M8 12v5M12 12v5M16 12v5" /></>,
  readoutrow: <><rect x="2" y="7" width="20" height="10" rx="1" /><path d="M5 12h6M15 10v4M18 10v4" /></>,
  repeater: <><rect x="3" y="3" width="18" height="5" rx="1" /><rect x="3" y="10" width="18" height="5" rx="1" /><path d="M3 19h18M7 21h10" /></>,
  stepper: <><rect x="3" y="6" width="18" height="12" rx="1" /><path d="M6 12h3M15 12h4M17 10v4M12 6v12" /></>,
  tabs: <><path d="M3 9V4h6v5M9 4h6v5M15 4h6v5" /><rect x="3" y="9" width="18" height="11" rx="1" /></>,
  text: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  textinput: <><rect x="3" y="7" width="18" height="10" rx="1" /><path d="M7 10h5M15 9v6M13 9h4M13 15h4" /></>,
  toggle: <><rect x="3" y="7" width="18" height="10" rx="5" /><circle cx="8" cy="12" r="3" /></>,
}

export const WIDGET_ICONS: Record<string, ReactNode> = Object.fromEntries(Object.entries(shapes).map(([type, shape]) => [type,
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{shape}</svg>,
]))
