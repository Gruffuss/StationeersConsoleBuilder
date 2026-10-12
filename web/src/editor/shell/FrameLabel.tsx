import type { Page } from '../../model/project'
import { SHAPES } from '../../model/shapes'

export function FrameLabel({ page }: { page: Page }) {
  return <div className="vb-frame-label unit">{page.name} · {page.shape === 'custom' ? `Custom ${page.size.w}×${page.size.h}` : SHAPES[page.shape].label}</div>
}
