import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { WIDGETS } from '../widgets/registry'
import { WIDGET_ICONS } from './widgetIcons'

it('draws a decorative stroke icon for every registered widget type', () => {
  expect(Object.keys(WIDGET_ICONS).sort()).toEqual(Object.keys(WIDGETS).sort())
  for (const type of Object.keys(WIDGETS)) {
    const html = renderToStaticMarkup(<>{WIDGET_ICONS[type]}</>)
    expect(html, type).toContain('viewBox="0 0 24 24"')
    expect(html, type).toContain('aria-hidden="true"')
    expect(html, type).toContain('stroke="currentColor"')
    expect(html, type).toContain('fill="none"')
  }
})
