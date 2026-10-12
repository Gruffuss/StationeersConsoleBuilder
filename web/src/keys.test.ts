// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { inDialog, ownsDelete, ownsKeys } from './keys'

const input = (type?: string) => {
  const e = document.createElement('input')
  if (type) e.type = type
  return e
}

describe('ownsKeys', () => {
  it('leaves the undo keys to what text is typed in', () => {
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    document.body.append(editable)
    for (const t of [input(), input('text'), input('number'), input('search'), document.createElement('textarea'), editable]) {
      expect(ownsKeys(t)).toBe(true)
    }
    editable.remove()
  })

  it('takes them over a checkbox, a select and a button', () => {
    for (const t of [input('checkbox'), document.createElement('select'), document.createElement('button'), document.body, null]) {
      expect(ownsKeys(t)).toBe(false)
    }
  })
})

describe('ownsDelete', () => {
  it('keeps Delete in any form control, any button, a side panel and the bars around the canvas, and gives it up elsewhere', () => {
    const inside = (cls: string) => {
      const box = document.createElement('div'), x = document.createElement('span')
      box.className = cls
      box.append(x)
      return x
    }
    const native = document.createElement('div')
    native.setAttribute('role', 'button')
    native.className = 'vb-native'
    for (const t of [input(), input('checkbox'), document.createElement('select'), document.createElement('textarea'), document.createElement('button'),
      ...['vb-props', 'vb-palette', 'vb-pages', 'vb-header', 'vb-page-settings', 'vb-statusbar', 'vb-taskbar', 'vb-crumbs'].map(inside)]) expect(ownsDelete(t)).toBe(true)
    for (const t of [native, inside('vb-canvas'), document.body, null]) expect(ownsDelete(t)).toBe(false)
  })
})

it('recognises dialog descendants without swallowing Delete on layer rows', () => {
  const dialog = document.createElement('dialog'), button = document.createElement('button')
  dialog.append(button)
  expect(inDialog(button)).toBe(true)
  expect(inDialog(document.body)).toBe(false)
  expect(inDialog(null)).toBe(false)
  const inspector = document.createElement('aside'), row = document.createElement('div')
  inspector.className = 'vb-sidebar'; row.className = 'vb-layer'; row.setAttribute('role', 'treeitem'); inspector.append(row)
  expect(ownsDelete(row)).toBe(false)
})
it('blocks editor routing with body focus only while a modal dialog is open', () => {
  const dialog = document.createElement('dialog')
  dialog.setAttribute('aria-modal', 'true'); document.body.append(dialog)
  try {
    dialog.showModal(); expect(inDialog(document.body)).toBe(true)
    dialog.close(); expect(inDialog(document.body)).toBe(false)
    dialog.removeAttribute('aria-modal'); dialog.show(); expect(inDialog(document.body)).toBe(false)
  } finally { dialog.remove() }
})
