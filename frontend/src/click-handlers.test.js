import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// `onClick={nutriSheet}` reads like `onClick={() => nutriSheet()}` and is not: React calls the
// handler with the click event, and an opener that takes a day reads that event as one. It
// opened the food log from Stats on "Invalid Date" and its Save failed silently — the same
// shape broke the sleep log and the health import. Nothing in a render catches it, so the
// source is read instead.

const ROOT = new URL('.', import.meta.url).pathname

const jsxFiles = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : jsxFiles(p)
  return /\.jsx$/.test(name) ? [p] : []
})

const FILES = jsxFiles(ROOT).map(p => ({ path: relative(ROOT, p), src: readFileSync(p, 'utf8') }))

// Every handler prop handed a bare identifier: onClick={foo}, onChange={foo}, …
const bareHandlers = src => [...src.matchAll(/\bon[A-Z]\w*=\{([A-Za-z_$][\w$]*)\}/g)].map(m => m[1])

// Exported functions of sheets.jsx that take at least one parameter.
function openersWithParams() {
  const src = readFileSync(join(ROOT, 'sheets.jsx'), 'utf8')
  const out = new Set()
  for (const m of src.matchAll(/export const (\w+) = (\(([^)]*)\)|[A-Za-z_$][\w$]*) =>/g)) {
    const params = m[3] !== undefined ? m[3].trim() : m[2]
    if (params) out.add(m[1])
  }
  for (const m of src.matchAll(/export (?:async )?function (\w+)\s*\(([^)]*)\)/g)) {
    if (m[2].trim()) out.add(m[1])
  }
  return out
}

describe('click handlers never hand the event to something expecting data', () => {
  it('finds the source to check — an empty scan would pass for the wrong reason', () => {
    expect(FILES.length).toBeGreaterThan(10)
    expect(openersWithParams().has('nutriSheet')).toBe(true)
  })

  it('no sheet opener is passed bare to an event prop', () => {
    const bad = FILES.flatMap(f => bareHandlers(f.src).filter(n => /Sheet$/.test(n)).map(n => f.path + ': ' + n))
    expect(bad).toEqual([])
  })

  it('no exported sheets.jsx function that takes an argument is passed bare to an event prop', () => {
    const takesArgs = openersWithParams()
    const bad = FILES.flatMap(f => bareHandlers(f.src).filter(n => takesArgs.has(n)).map(n => f.path + ': ' + n))
    expect(bad).toEqual([])
  })
})
