#!/usr/bin/env node
/* Generate api/exercise-names.json — exercise id -> name, and nothing else.
 *
 * The API has no reason to carry the 890 KB exercise dataset, but it cannot serve a
 * readable training log without names: "0025" means nothing to whatever is reading it.
 * The names alone are a fortieth of the size, so they travel and the rest does not.
 *
 * Regenerate whenever the dataset changes:  node scripts/build-exercise-names.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(ROOT, 'frontend/src/lib/exercises-data.js'), 'utf8')
const json = src.slice(src.indexOf('['), src.lastIndexOf(']') + 1)
const names = {}
for (const e of JSON.parse(json)) names[e.id] = e.n

const out = path.join(ROOT, 'api/exercise-names.json')
fs.writeFileSync(out, JSON.stringify(names))
console.log(`${Object.keys(names).length} names -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
