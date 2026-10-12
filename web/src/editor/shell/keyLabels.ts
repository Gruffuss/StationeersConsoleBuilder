const LABELS: Record<string, string> = { Mod: 'Ctrl', Delete: 'Del', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }

export const keyLabel = (name: string): string => name.split('+').map(part => LABELS[part] ?? part).join('+')
export const keysLabel = (keys?: readonly string[]): string => keys?.map(keyLabel).join(' · ') ?? ''
