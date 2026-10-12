import { frameworkUrl } from './framework'

// Boots the .NET runtime inside this worker and serves bridge.ts requests.
// Each reply carries its request's id: that is how the bridge's watchdog knows the request was answered.
const { dotnet } = await import(/* @vite-ignore */ frameworkUrl(import.meta.env.BASE_URL, self.location.origin))
// A fatal runtime error (stack overflow, FailFast) ends the runtime without an `error` event: say so, so the page restarts at once.
const crashed = (why: unknown) => self.postMessage({ kind: 'crashed', why: String(why) })
const { getAssemblyExports, getConfig } = await dotnet.withModuleConfig({
  onAbort: crashed, onExit: (code: number) => crashed(`the runtime exited (code ${code})`) }).create()
const api = (await getAssemblyExports(getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports
self.postMessage({ kind: 'ready' })

type Request = { id: number } & ({ kind: 'load'; lua: string; w: number; h: number; sizes: string; host: string } | { kind: 'tick' }
  | { kind: 'frame'; surface: string; scale: number; tag: boolean } | { kind: 'patch'; surface: string; element: string; src: string }
  | { kind: 'pointer'; surface: string; x: number; y: number; type: string; dy: number; pointer: number }
  | { kind: 'visit'; page: string } | { kind: 'sim'; json: string }
  | { kind: 'readPicture'; src: string } | { kind: 'readPictureBytes'; bytes: Uint8Array }
  | { kind: 'setImage'; src: string; width: number; height: number; error: string | null }
  | { kind: 'checkExport'; lua: string; host: string; pages: string }
  | { kind: 'captureScript'; lua: string; w: number; h: number; host: string; allowanceMs: number })

const status = (id: number, json: string) => self.postMessage({ id, kind: 'status', status: JSON.parse(json) })

// The .NET runtime's view on a managed array: copy it out, then dispose it to release the array.
type MemoryView = { length: number; set(source: Uint8Array): void; slice(): Uint8Array; dispose(): void }

// A picture read writes its input into an array the core holds (PictureInput), then reads it. The reply is one binary
// block (core/Core/Pictures.cs): "VBP1", the metadata's length, the metadata as JSON, then the payload, which goes to the
// page as a view on the transferred reply. `sent`: a fetched file, which the core does not send back.
function picture(id: number, input: Uint8Array, read: () => MemoryView, sent?: Uint8Array) {
  const room: MemoryView = api.PictureInput(input.length)
  try { if (room.length === input.length && input.length) room.set(input) } finally { room.dispose() }
  const view = read()
  let reply: Uint8Array
  try { reply = view.slice() } finally { view.dispose() }
  const at = 8 + new DataView(reply.buffer, reply.byteOffset, reply.byteLength).getInt32(4, true)
  const result = JSON.parse(new TextDecoder().decode(reply.subarray(8, at))), payload = reply.subarray(at)
  if (result.format === 'bmp' || result.format === 'gif') result.rgba = payload
  else if (result.format) result.bytes = sent ?? payload
  const transfer = [reply.buffer as ArrayBuffer]
  if (sent && result.bytes === sent) transfer.push(sent.buffer as ArrayBuffer)
  self.postMessage({ id, kind: 'picture', result }, { transfer })
}

async function serve(m: Request) {
  if (m.kind === 'readPicture') picture(m.id, new TextEncoder().encode(m.src), () => api.ReadPicture())
  if (m.kind === 'readPictureBytes') picture(m.id, m.bytes, () => api.ReadPictureBytes(), m.bytes)
  if (m.kind === 'setImage') {
    api.SetImage(m.src, m.width, m.height, m.error)
    self.postMessage({ id: m.id, kind: 'imageSet' })
  }
  if (m.kind === 'captureScript') self.postMessage({ id: m.id, kind: 'captureReport', report: JSON.parse(await api.CaptureScript(m.lua, m.w, m.h, m.host, m.allowanceMs)) })
  if (m.kind === 'checkExport') self.postMessage({ id: m.id, kind: 'exportReport', report: JSON.parse(await api.CheckExport(m.lua, m.host, m.pages)) })
  if (m.kind === 'load') status(m.id, await api.Load(m.lua, m.w, m.h, m.sizes, m.host ?? ''))
  if (m.kind === 'pointer') status(m.id, api.Pointer(m.surface, m.x, m.y, m.type, m.dy, m.pointer))
  if (m.kind === 'visit') status(m.id, api.Visit(m.page))
  if (m.kind === 'sim') status(m.id, api.Sim(m.json))
  if (m.kind === 'tick') status(m.id, await api.Tick())
  if (m.kind === 'patch') status(m.id, api.Patch(m.surface, m.element, m.src))
  if (m.kind === 'frame') {
    const started = performance.now()
    const bytes: Uint8Array = api.Frame(m.surface, m.scale, m.tag)  // JSExport hands byte[] over as a Uint8Array copy
    const workerMs = performance.now() - started
    const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    const buf = whole ? bytes.buffer as ArrayBuffer : bytes.slice().buffer
    self.postMessage({ id: m.id, kind: 'frame', buf, workerMs }, { transfer: [buf] })
  }
}

// One request at a time: a tick must never start on the chip while a load is still awaiting. A request that throws
// leaves the chip in an unknown state, so the page replaces the worker, and the reason goes with the crash.
const failed = (e: unknown) => {
  console.error('core.worker: request failed', e)
  crashed(e)
}
let queue = Promise.resolve()
self.onmessage = (e: MessageEvent<Request>) => { queue = queue.then(() => serve(e.data)).catch(failed) }

export {}  // a module, for top-level await
