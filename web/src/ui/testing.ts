export function controlNames(root: ParentNode): string[] {
  const controls = root.querySelectorAll('button, input, select, textarea, [role="button"], [role="tab"], [role="treeitem"], [role="radiogroup"], [role="menuitem"], a[href]')
  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  return Array.from(controls).filter(el => !(el.matches('input[type="radio"]') && el.closest('[role="radiogroup"]'))).map(el => {
    const labelled = el.getAttribute('aria-labelledby')?.split(/\s+/).map(id => text(el.ownerDocument.getElementById(id))).filter(Boolean).join(' ')
    const labels = 'labels' in el ? (el as HTMLInputElement).labels : null
    const labelText = Array.from(labels ?? []).map(label => {
      const copy = label.cloneNode(true) as Element
      copy.querySelectorAll('button, input, select, textarea').forEach(control => control.remove())
      return text(copy)
    }).filter(Boolean).join(' ')
    return el.getAttribute('aria-label') || labelled || labelText || text(el) || el.getAttribute('placeholder') || el.getAttribute('title') || `<${el.tagName.toLowerCase()}>`
  }).sort()
}
