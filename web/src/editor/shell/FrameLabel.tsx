import type { Page } from '../../model/project'
import { SHAPES, type ShapeKind } from '../../model/shapes'
import type { Action } from '../../model/store'
import { Icon } from '../../ui/icons'
import { MenuButton } from '../../ui/Menu'

// The page's name and console size above the page; the size opens the console sizes in one click (owner, 2026-10-13:
// the size control should be more visible and easier to reach). Custom sizes are typed in the inspector's Page section.
export function FrameLabel({ page, dispatch, onCustom }: { page: Page; dispatch(a: Action): void; onCustom(): void }) {
  return <div className="vb-frame-label unit">{page.name} · <MenuButton label="Console size" className="vb-frame-size" items={() => [
    ...Object.entries(SHAPES).map(([shape, s]) => ({ kind: 'item' as const, id: shape, label: s.label, checked: page.shape === shape,
      run: () => dispatch({ type: 'setPageShape', pageId: page.id, shape: shape as ShapeKind, size: page.size }) })),
    { kind: 'separator' as const },
    { kind: 'item' as const, id: 'custom', label: 'Custom size…', checked: page.shape === 'custom', run: onCustom },
  ]}>{page.shape === 'custom' ? `Custom ${page.size.w}×${page.size.h}` : SHAPES[page.shape].label}<Icon name="chevron-down" /></MenuButton></div>
}
