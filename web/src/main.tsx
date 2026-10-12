import './ui/tokens.css'
import './ui/fonts.css'
import './ui/base.css'
import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadImportedFonts, registerFaces, registerPageFonts, setFontMetadataReader } from './editor/fonts'
import { readFontMetadata } from './editor/fontMetadata'
import { configurePageFonts } from './editor/pageFonts'
import './app.css'

// An error a component does not handle shows its message instead of a blank page.
class Boundary extends Component<{ children: ReactNode }, { failed: string | null }> {
  state = { failed: null }
  static getDerivedStateFromError(e: unknown) { return { failed: e instanceof Error ? e.message : String(e) } }
  render() {
    return this.state.failed === null ? this.props.children : <pre className="vb-error" role="alert">VectorBuilder stopped: {this.state.failed}</pre>
  }
}

const container = document.getElementById('root')! as HTMLElement & { vbRoot?: ReturnType<typeof createRoot> }
// The entry module can run again during HMR; the root and registered fonts belong to its container.
if (!container.vbRoot) {
  setFontMetadataReader(readFontMetadata)
  configurePageFonts({ readFontMetadata, registerPageFonts })
  registerFaces()
  void loadImportedFonts()
  container.vbRoot = createRoot(container)
}
container.vbRoot.render(<StrictMode><Boundary><App /></Boundary></StrictMode>)
