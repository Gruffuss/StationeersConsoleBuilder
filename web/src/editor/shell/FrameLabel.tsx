import type { Page } from '../../model/project'
import { SIZES, sizeOf } from '../../model/shapes'
import type { Action } from '../../model/store'
import { Icon } from '../../ui/icons'
import { MenuButton } from '../../ui/Menu'

// The page's name and console size above the page; the size opens the console sizes in one click (owner, 2026-10-13:
// the size control should be more visible and easier to reach). Custom sizes are typed in the inspector's Page section.
export function FrameLabel({ page, dispatch, onCustom }: { page: Page; dispatch(a: Action): void; onCustom(): void }) {
  const current = sizeOf(page.shape)   // a page on any model of a size shows that size and keeps its model
  return <div className="vb-frame-label unit">{page.name} · <MenuButton label="Console size" className="vb-frame-size" items={() => [
    ...SIZES.map(s => ({ kind: 'item' as const, id: s.keys[0], label: s.label, checked: s === current,
      run: () => { if (s !== current) dispatch({ type: 'setPageShape', pageId: page.id, shape: s.keys[0], size: page.size }) } })),
    { kind: 'separator' as const },
    { kind: 'item' as const, id: 'custom', label: 'Custom size…', checked: page.shape === 'custom', run: onCustom },
  ]}>{current ? current.label : `Custom ${page.size.w}×${page.size.h}`}<Icon name="chevron-down" /></MenuButton></div>
}
