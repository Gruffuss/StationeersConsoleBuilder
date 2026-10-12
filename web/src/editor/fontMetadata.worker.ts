import type { MetadataRequest, MetadataResult } from './fontMetadata'
import { frameworkUrl } from '../runtime/framework'

// A separate .NET instance: these exports never load a chip or join its request queue.
const crashed = (why: unknown) => self.postMessage({ kind: 'crashed', why: String(why) })
const boot = (async () => {
  const { dotnet } = await import(/* @vite-ignore */ frameworkUrl(import.meta.env.BASE_URL, self.location.origin))
  const { getAssemblyExports, getConfig } = await dotnet.withModuleConfig({
    onAbort: crashed, onExit: (code: number) => crashed(`the metadata runtime exited (code ${code})`),
  }).create()
  return (await getAssemblyExports(getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports
})()
boot.then(api => {
  // .NET identifies a standalone worker by its empty onmessage during import; install ours after boot.
  let queue = Promise.resolve()
  self.onmessage = (e: MessageEvent<MetadataRequest>) => {
    queue = queue.then(() => {
      const m = e.data
      if (m.kind !== 'metadata' || !(m.data instanceof ArrayBuffer)) throw new Error('invalid metadata worker request')
      const result: MetadataResult = JSON.parse(api.ReadFontMetadata(new Uint8Array(m.data)))
      self.postMessage({ id: m.id, result })
    }).catch(crashed)
  }
  self.postMessage({ kind: 'ready' })
}, crashed)
