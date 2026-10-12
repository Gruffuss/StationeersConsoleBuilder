import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { extract, methods } from './extract'

const vector = new URL('../../../core/vendor/vector/', import.meta.url)
const read = (f: string) => readFileSync(new URL(f, vector), 'utf8')
const sources = () => ({ sceneModel: read('SceneModel.cs'), expression: read('Expression.cs'),
  colourFilter: read('ColourFilter.cs'), csproj: read('ScriptedScreensVector.csproj') })

it('matches the pinned parser (regenerate with: npx vitest run src/schema/extract.test.ts -u)', async () => {
  const x = extract(sources())
  await expect(JSON.stringify(x, null, 2) + '\n').toMatchFileSnapshot('./extracted.json')
})

// The method split, checked while planning on the tag: 60 methods at v0.11.112; 14 read a quoted key from map/props (own-only diagnostics are classified separately).
it('splits SceneModel.cs into its 60 methods, 14 of them reading keys', () => {
  const all = methods(read('SceneModel.cs'))
  expect(all.length).toBe(60)
  expect(all.map(m => m.name)).toContain('CheckFormat')
  expect(all.filter(m => /\b(?:Attr|Pair|Live|Count|PropNumber|PropString|PropText|Numbers|HasKey|PropValue)\(\s*(?:map|props)\s*,\s*"/.test(m.body)).map(m => m.name).sort())
    .toEqual(['ClipOutline', 'Parse', 'ParseCorners', 'ParseDefs', 'ParseFill', 'ParseNode', 'ParseShadows', 'ParseStroke', 'ParseStyle',
      'PatchNodesCore', 'ReadData', 'ReadEasing', 'ReadStops', 'ReadStrokeStyle'])
})

// A re-pin that reads keys in a way the extraction cannot place fails here instead of dropping the keys.
const changed = (from: string, to: string) => {
  const s = sources()
  if (!s.sceneModel.includes(from)) throw new Error(`the probe's text is gone: ${from}`)
  s.sceneModel = s.sceneModel.replace(from, to)
  return () => extract(s)
}
const appended = (method: string) => changed('\n    private static float PropNumber(', `\n${method}\n    private static float PropNumber(`)

it('refuses a reader method it cannot place, whatever it reads', () => {
  expect(appended('    private static void ParseThing(SS.UiProp[] map)\n    {\n        var x = Attr(map, "x", 0f);\n    }'))
    .toThrow('unclassified reader method ParseThing')
  expect(appended('    private static void ParseThing(SS.UiProp[] m)\n    {\n        var x = Attr(m, "x", 0f);\n    }'))
    .toThrow('unclassified reader method ParseThing')
})

it('refuses a read of anything but the node map unless it is listed (the paint maps are)', () => {
  expect(changed('node.Id = PropText(map, "id");', 'node.Id = PropText(other, "id");'))
    .toThrow('unclassified read PropText(other, "id") in ParseNode')
  expect(changed('PropString(paint.Value.Map, "grad")', 'PropString(paint.Value.Map, "gradient")'))
    .toThrow('unclassified read PropString(paint.Value.Map, "gradient") in ParseFill')
  // an SC reads its scroll offset from its own map, as written (0.11.98): listed too
  expect(changed('Attr(own, "sov", 0f)', 'Attr(own, "sox", 0f)')).toThrow('unclassified read Attr(own, "sox") in ParseNode')
  expect(changed('node.Id = PropText(map, "id");', 'node.Id = PropText(own, "id");')).toThrow('unclassified read PropText(own, "id") in ParseNode')
})

it('refuses a reader it does not know, a read outside any method, a case it cannot split and a header it cannot see', () => {
  expect(changed('PropNumber(map, "seg", 8f)', 'PropInt(map, "seg", 8f)')).toThrow('unknown reader PropInt')
  expect(changed('using System;', 'using System;\nstatic class Z { static object z = PropValue(map, "zz"); }')).toThrow('a read outside any method')
  expect(changed('case "R":', 'case "R" or "RR":')).toThrow('unsupported case label: case "R" or "RR":')
  expect(appended('    private static T Get<T>(SS.UiProp[] map)\n    {\n        return (T)(object)PropValue(map, "zz")!;\n    }'))
    .toThrow('a member header the method split missed')
  expect(changed('if (gradient.Radial)', 'if (radial)')).toThrow('cannot split GL/GR at its radial branch')
})
