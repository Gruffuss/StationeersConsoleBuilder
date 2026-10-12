import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

const bmpPalette = Buffer.alloc(54)
bmpPalette.write('BM')
bmpPalette.writeInt32LE(54, 10)
bmpPalette.writeInt32LE(40, 14)
bmpPalette.writeInt32LE(1, 18)
bmpPalette.writeInt32LE(1, 22)
bmpPalette.writeUInt16LE(8, 28)
bmpPalette.writeInt32LE(0x7fffffff, 46)
const gifDescriptor = Buffer.from('R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64')
gifDescriptor.writeUInt16LE(30000, 24)
gifDescriptor.writeUInt16LE(30000, 26)
// A comment extension before the image makes the preflight walk blocks rather than assume a fixed descriptor offset.
const gifWithComment = Buffer.concat([gifDescriptor.subarray(0, 19), Buffer.from([0x21, 0xfe, 3, 65, 66, 67, 0]), gifDescriptor.subarray(19)])
const palette256 = Buffer.alloc(54 + 256 * 4 + 4)
bmpPalette.copy(palette256)
palette256.writeInt32LE(54 + 256 * 4, 10)
palette256.writeInt32LE(256, 46)
const gifAtLimit = Buffer.from(gifDescriptor)
gifAtLimit.writeUInt16LE(4096, 24)
gifAtLimit.writeUInt16LE(4096, 26)

// The worker's read (core.worker.ts): the input written into the core's own array, then a VBP1 reply.
const read=`const read=(kind,input)=>{const room=api.PictureInput(input.length); if(room.length) room.set(input); room.dispose();
    const v=kind==='bytes'?api.ReadPictureBytes():api.ReadPicture(); const r=v.slice(); v.dispose(); const at=8+new DataView(r.buffer).getInt32(4,true);
    return {...JSON.parse(new TextDecoder().decode(r.subarray(8,at))),payload:r.subarray(at)}};
    const url=s=>read('url',new TextEncoder().encode(s)); const bytes=b=>read('bytes',Uint8Array.from(atob(b),c=>c.charCodeAt(0)));`

it.each([
  ['8-bit BMP palette', bmpPalette, 'too large: BMP palette exceeds 256 entries', palette256],
  ['GIF image descriptor', gifWithComment, 'too large: GIF image exceeds 16777216 pixels', gifAtLimit],
] as const)('reports a hostile %s as too large and keeps the core alive', (_name, bytes, message, accepted) => {
  const src = `data:application/octet-stream;base64,${bytes.toString('base64')}`
  const code = `import assert from 'node:assert/strict';
    const {dotnet}=await import('./public/_framework/dotnet.js'); const runtime=await dotnet.create();
    const api=(await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports;${read}
    assert.equal(url(${JSON.stringify(src)}).error,${JSON.stringify(message)});
    assert.equal(bytes(${JSON.stringify(bytes.toString('base64'))}).error,${JSON.stringify(message)});
    const boundary=bytes(${JSON.stringify(accepted.toString('base64'))});
    assert.equal(boundary.error,undefined); assert.equal(boundary.width,1); assert.equal(boundary.height,1);
    assert.equal(url('data:image/png;base64,iVBORw0KGgo=').format,'png');
    console.log('picture limit clean'); runtime.exit(0);`
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })).toContain('picture limit clean')
}, 30000)

it('explains that non-data picture sources need a different read path', () => {
  const code = `import assert from 'node:assert/strict';
    const {dotnet}=await import('./public/_framework/dotnet.js'); const runtime=await dotnet.create();
    const api=(await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports;${read}
    for(const src of ['https://example.com/a.png','point:https://example.com/a.png','file:///a.bmp'])
      assert.equal(url(src).error,'the picture source is not a data: URL');
    assert.equal(url('data:image/png;base64,!').error,'unreadable data: URL');
    console.log('picture source clean'); runtime.exit(0);`
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })).toContain('picture source clean')
}, 30000)

it('the published core reads picture bytes, registers both sampling keys and writes VBF3', () => {
  const code = `import assert from 'node:assert/strict';
    const {dotnet}=await import('./public/_framework/dotnet.js'); const runtime=await dotnet.create();
    const api=(await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports;${read}
    const src='data:image/png;base64,iVBORw0KGgo=';
    const png=url(src); assert.equal(png.format,'png'); assert.equal(Buffer.from(png.payload).toString('base64'),'iVBORw0KGgo=');
    assert.equal(url('data:image/png;base64,!').error,'unreadable data: URL');
    const jpeg=bytes('/9j/AA=='); assert.equal(jpeg.format,'jpeg'); assert.equal(jpeg.payload.length,0);
    assert.deepEqual(JSON.parse(api.SetImage(src,4,2,null)),{});
    const lua="local ui=ss.ui.surface('main'); ui:element({id='s',type='vector',rect={unit='px',x=0,y=0,w=100,h=100},props={src=[[SCENE w=100 h=100\\nIMG w=100 h=100 src="+JSON.stringify(src)+" smp=point]]}})";
    const status=JSON.parse(await api.Load(lua,100,100,'{}','{}')); assert.equal(status.state,'Running',status.error);
    const frame=api.Frame('main',1,false).slice(); assert.equal(new TextDecoder().decode(frame.subarray(0,4)),'VBF3');
    const j=new DataView(frame.buffer).getInt32(16,true);
    const body=JSON.parse(new TextDecoder().decode(frame.subarray(frame.length-j)));
    assert.equal(body.images.length,1,JSON.stringify(body)); assert.equal(body.images[0].src,'point:'+src); assert.deepEqual(body.pending,[]);
    assert.deepEqual(body.problems,[]); console.log('picture core clean'); runtime.exit(0);`
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })).toContain('picture core clean')
}, 30000)
