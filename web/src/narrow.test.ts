import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8')
const rule = (text: string, selector: string) => text.slice(text.indexOf(`${selector} {`)).split('}')[0]
it('fits the breadcrumb to content and leaves an empty mounted nav undecorated', () => {
  expect(rule(css, '.vb-crumbs')).toContain('right: auto')
  expect(rule(css, '.vb-crumbs')).toContain('max-width:')
  const sidebar = readFileSync(new URL('./editor/sidebar.css', import.meta.url), 'utf8')
  expect(rule(sidebar, '.vb-crumbs.raised:empty')).toContain('visibility: hidden')
})
it('bounds menu and submenu lists within the viewport and scrolls them internally', () => {
  const base = readFileSync(new URL('./ui/base.css', import.meta.url), 'utf8')
  for (const selector of ['.vb-menu-panel', '.vb-submenu-panel']) {
    expect(rule(base, selector)).toContain('max-height:')
    expect(rule(base, selector)).toContain('overflow-y: auto')
  }
})
it('keeps the sidebar tabs above its scrolling widget list', () => {
  expect(rule(css, '.vb-sidebar > [role=tablist]')).toContain('position: sticky')
  expect(rule(css, '.vb-sidebar > [role=tablist]')).toContain('top: 0')
})
it('gives the wide shell stable regions and a single scrolling status line', () => {
  expect(rule(css, '.vb-workspace')).toContain('clamp(200px,18vw,320px)')
  for (const declaration of ['height:', 'flex-wrap: nowrap', 'overflow-x: auto']) expect(rule(css, '.vb-statusbar')).toContain(declaration)
  for (const declaration of ['flex: 1 1 0', 'min-width: 0', 'white-space: nowrap']) expect(rule(css, '.vb-save')).toContain(declaration)
  expect(rule(css, '.vb-crumbs')).toContain('white-space: nowrap')
})
it('stacks rail, canvas, sidebar and inspector at 840px and keeps the footer sticky', () => {
  const narrow = css.slice(css.indexOf('@media (max-width: 840px)'))
  expect(rule(narrow, '.vb-shell')).toContain('min-height: 100dvh')
  expect(rule(narrow, '.vb-workspace')).toContain('flex-direction: column')
  expect(rule(narrow, '.vb-center')).toContain('order: 1')
  expect(rule(narrow, '.vb-sidebar')).toContain('order: 2')
  expect(rule(narrow, '.vb-inspector')).toContain('order: 3')
  expect(rule(narrow, '.vb-canvas-area')).toContain('height: 70vh')
  expect(rule(narrow, '.vb-source')).toContain('height: 40vh')
  expect(rule(narrow, '.vb-statusbar')).toContain('position: sticky')
  expect(rule(narrow, '.vb-statusbar')).toContain('bottom: 0')
})
