// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '../testing'
import { Icon, type IconName } from './icons'

const names: IconName[] = ['select', 'points', 'pen', 'path', 'rect', 'ellipse', 'polygon', 'line', 'text', 'image', 'gradient', 'add', 'remove', 'close', 'chevron-down', 'chevron-right', 'chevron-up', 'play', 'stop', 'export', 'download', 'upload', 'eye', 'eye-off', 'lock', 'unlock', 'group', 'widget', 'page', 'detach', 'trash', 'more', 'reset', 'copy', 'link', 'code', 'check', 'magnet', 'warn', 'info', 'file', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'align-left', 'align-centre', 'align-right', 'align-top', 'align-middle', 'align-bottom', 'distribute-h', 'distribute-v']

it('distinguishes export from download and points from select', () => {
  const ui = mount(<><Icon name="export" /><Icon name="download" /><Icon name="points" /><Icon name="select" /></>)
  try {
    const paths = Array.from(ui.container.querySelectorAll('svg')).map(svg => svg.querySelector('path')!.getAttribute('d'))
    expect(paths[0]).not.toBe(paths[1]); expect(paths[2]).not.toBe(paths[3])
  } finally { ui.unmount() }
})

it.each(names)('%s is a hidden line SVG with a shape', name => {
  const ui = mount(<Icon name={name} />)
  const svg = ui.container.querySelector('svg.ic')!
  expect(svg).not.toBeNull()
  expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
  expect(svg.getAttribute('aria-hidden')).toBe('true')
  expect(svg.getAttribute('stroke')).toBe('currentColor')
  expect(svg.querySelector('path, rect, circle, ellipse, line, polyline, polygon')).not.toBeNull()
  ui.unmount()
})
