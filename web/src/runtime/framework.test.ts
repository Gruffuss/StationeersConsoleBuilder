import { expect, it } from 'vitest'
import { frameworkUrl } from './framework'

it('finds the .NET runtime under the site base path', () => {
  expect(frameworkUrl('/vb/', 'https://x.example')).toBe('https://x.example/vb/_framework/dotnet.js')
  expect(frameworkUrl('/scripted-screens-vector-builder/', 'https://owner.github.io'))
    .toBe('https://owner.github.io/scripted-screens-vector-builder/_framework/dotnet.js')
})
it('keeps the root when the site is served from it', () => {
  expect(frameworkUrl('/', 'http://localhost:5173')).toBe('http://localhost:5173/_framework/dotnet.js')
})
