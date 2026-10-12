import { describe, expect, it } from 'vitest'
import { checkExpr } from './expr'

describe('checkExpr (Lua 5.2)', () => {
  it('passes Lua 5.2 expressions: arithmetic, calls, logic, strings with keywords inside, long brackets, comparisons', () => {
    for (const ok of ['P.tankP * 100', 'S.mode == 2 and 1 or 0', 'util.clock_time("HH:MM")', '"end of the line"', "'do it'", '[[return x]]',
      '[==[ ]] end ]==]', 'x ~= 1', '#L.m > 0', '-x ^ 2', 'a <= b and b >= c', 'math.max(1, 2)', '{ 1, 2 }', 't[1]', '0x1F + 1e-3', 'a .. b', 'not C.go'])
      expect([ok, checkExpr(ok)]).toEqual([ok, null])
  })
  it('passes a table constructor\'s named fields: an = directly inside { } names a field and assigns nothing', () => {
    for (const ok of ['{ a = 1 }', 'f{ a = 1, [k] = 2 }', '{ x = { y = S.v == 1 } }', 'g({ n = 1 }, 2)'])
      expect([ok, checkExpr(ok)]).toEqual([ok, null])
    for (const bad of ['{ (a = 1) }', 't[a = 1]', 'f({ a = 1 }, b = 2)', '{ a = 1 } x = 2'])
      expect([bad, checkExpr(bad)]).toEqual([bad, 'an expression cannot assign ("=")'])
  })
  it('refuses a carriage return anywhere: Lua counts a lone CR as a line break and the line map counts LF only; LF passes', () => {
    for (const bad of ['1 +\r 2', '1 +\r\n 2', '1 +\n\r 2', '[[a\rb]]', '"a\rb"', 'x --\r'])
      expect([bad, checkExpr(bad)]).toEqual([bad, 'a carriage return is not allowed in an expression'])
    expect(checkExpr('1 +\n 2')).toBe(null)
  })
  it('refuses what would change the script: statements, function, ;, assignment, comments, unbalanced brackets, empty', () => {
    for (const kw of ['end', 'local', 'return', 'do', 'then', 'else', 'elseif', 'while', 'repeat', 'until', 'for', 'in', 'if', 'break', 'goto', 'function'])
      expect(checkExpr(`x ${kw} y`)).toBe(`"${kw}" is not allowed in an expression`)
    expect(checkExpr('1; 2')).toBe('";" is not allowed in an expression')
    expect(checkExpr('x = 1')).toBe('an expression cannot assign ("=")')
    expect(checkExpr('1) end x = (2')).toBe('")" closes nothing')
    expect(checkExpr('f(1')).toBe('"(" is not closed')
    expect(checkExpr('x -- note')).toBe('comments are not allowed in an expression')
    expect(checkExpr('"abc')).toBe('a string is not closed')
    expect(checkExpr('[[abc')).toBe('a long string is not closed')
    expect(checkExpr('  ')).toBe('an expression is empty')
  })
})
