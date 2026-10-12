import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { FakeWorker } from './testing'
import { captureScript } from './adoptCapture'
const capture = JSON.parse(readFileSync(new URL('../../test/fixtures/adopt/src.capture.json', import.meta.url), 'utf8'))
const req = { lua: 'source', size: { w: 460, h: 460 } }
afterEach(() => vi.useRealTimers())
it('boots one disposable core, reads a capture and terminates it', async () => {
  const w = new FakeWorker(), p = captureScript(() => w as unknown as Worker, req)
  w.reply({kind:'ready'})
  expect(w.last()).toMatchObject({kind:'captureScript', lua:'source', w:460, h:460, host:''})
  w.reply({id:1, kind:'captureReport', report:capture})
  expect(await p).toMatchObject({complete:true})
  expect(w.terminated).toBe(true)
})
it.each(['abort','crash','bad','boot-timeout','capture-timeout'])('leaves capture incomplete on %s and closes its worker', async why => {
  vi.useFakeTimers()
  const w = new FakeWorker(), abort = new AbortController(), p = captureScript(() => w as unknown as Worker, req, abort.signal)
  if (why === 'abort') abort.abort()
  else if (why === 'crash') w.reply({kind:'crashed',why:'crash'})
  else if (why === 'bad') { w.reply({kind:'ready'}); w.reply({id:1,kind:'captureReport',report:{}}) }
  else { if (why === 'capture-timeout') w.reply({kind:'ready'}); await vi.advanceTimersByTimeAsync(60001) }
  expect(await p).toMatchObject({incomplete:expect.stringMatching(/cancelled|could not complete/i)})
  expect(w.terminated).toBe(true)
})
