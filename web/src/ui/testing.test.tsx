// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '../testing'
import { controlNames } from './testing'

it('records a sorted multiset with labels before text and counts radiogroups instead of their radios', () => {
  const ui = mount(<>
    <button aria-label="Named">Ignored</button>
    <label>Wrapped <select><option>Ignored option</option></select></label>
    <label htmlFor="number">Number</label><input id="number" />
    <span id="first">First</span><span id="second">Second</span><input aria-labelledby="first second" />
    <button>Text button</button><button>Text button</button><input placeholder="Placeholder" />
    <div role="radiogroup" aria-label="Mode"><label>One<input type="radio" name="mode" /></label><label>All<input type="radio" name="mode" /></label></div>
    <textarea title="Title" /><input /><a href="#">Link</a>
  </>)
  expect(controlNames(ui.container)).toEqual(['<input>', 'First Second', 'Link', 'Mode', 'Named', 'Number', 'Placeholder', 'Text button', 'Text button', 'Title', 'Wrapped'])
  ui.unmount()
})
