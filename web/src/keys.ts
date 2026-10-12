// Which focused elements keep Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and Esc for themselves: the ones text is typed in (the code
// pane is contenteditable), which have their own undo. A checkbox, a select or a button has none, so the editor's undo
// works while one has the focus (M1 found it dead there).
const TYPED = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])   // an <input> with no type is text

export const ownsKeys = (t: EventTarget | null) => t instanceof HTMLElement
  && (t.isContentEditable || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TYPED.has(t.type)))

// The bars around the canvas: the palette, the page bar, the toolbar and the breadcrumb. Their controls are not the widget.
const BARS = '.vb-props, .vb-palette, .vb-pages, .vb-header, .vb-page-settings, .vb-statusbar, .vb-crumbs, .vb-taskbar'
export const inDialog = (t: EventTarget | null) => (t instanceof Element && t.closest('dialog') !== null)
  || document.querySelector('dialog[open][aria-modal="true"]') !== null
/** Which focused elements keep Delete, which removes the selected widget: those that keep the undo keys, any other form
 *  control (a checkbox, a select), any button (a palette entry, a page tab, a crumb: pressing it is not choosing the widget),
 *  and anything in a side panel or a bar around the canvas. The canvas and a native's placeholder (a div with the role
 *  button, which stands for the selection) leave it to the editor. */
export const ownsDelete = (t: EventTarget | null) => ownsKeys(t) || (t instanceof Element && t.closest(`input, select, button, ${BARS}`) !== null)
