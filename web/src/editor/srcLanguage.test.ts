import { classHighlighter, highlightTree } from '@lezer/highlight'
import { describe, expect, it } from 'vitest'
import { srcLanguage } from './srcLanguage'

// The classes the editor's highlighter gives each token. A token name that resolves to no tag gets no class, so it fails here.
const classes = (text: string) => {
  const out: [string, string][] = []
  highlightTree(srcLanguage.parser.parse(text), classHighlighter, (from, to, cls) => out.push([text.slice(from, to), cls]))
  return out
}

describe('srcLanguage', () => {
  it('tags ops, keys, numbers, colours, expressions, strings and comments', () => {
    expect(classes('R x=1 f=#5FD9A8 y==$a*2 text="hi" # c')).toEqual([
      ['R', 'tok-typeName'], ['x', 'tok-propertyName'], ['1', 'tok-number'], ['f', 'tok-propertyName'],
      ['#5FD9A8', 'tok-atom'], ['y', 'tok-propertyName'], ['=$a*2', 'tok-string2'],   // special(string)
      ['text', 'tok-propertyName'], ['"hi"', 'tok-string'], ['# c', 'tok-comment'],
    ])
  })

  it('tags data names, paint ids and brackets', () => {
    expect(classes('G t=[1,2] {\n    T text=$o2 f=@heat\n}')).toEqual([
      ['G', 'tok-typeName'], ['t', 'tok-propertyName'], ['[', 'tok-punctuation'], ['1', 'tok-number'], ['2', 'tok-number'],
      [']', 'tok-punctuation'], ['{', 'tok-punctuation'],
      ['T', 'tok-typeName'], ['text', 'tok-propertyName'], ['$o2', 'tok-variableName'], ['f', 'tok-propertyName'],
      ['@heat', 'tok-labelName'], ['}', 'tok-punctuation'],
    ])
  })
})
