#!/usr/bin/env node
/* Builds the app into one self-contained HTML file, mounted in an iPhone chassis.
 *
 * The point is to be able to look at a feature on something phone-shaped without a
 * server, a device, or a network — the file opens straight from disk and can be
 * published as-is. So it is the demo build (VITE_DEMO=1): no backend, no passkeys,
 * a seeded example profile in localStorage.
 *
 * Three things have to be folded in for that to hold:
 *   · one JS chunk      — nothing can be lazily fetched when there is no server
 *   · media inline      — see scripts/preview-media.py
 *   · instructions out  — src/instr is 7 MB of exercise text and the largest thing
 *                         in the bundle by far; stubbed to empty packs, so the app
 *                         falls back to the English steps already in the dataset
 *
 * The app runs inside an iframe rather than directly on the page: it expects to own
 * a viewport (100vh, position:fixed tab bar, full-screen sheets), and an iframe is
 * the only way to give it a 390x844 one without rewriting its layout from outside.
 *
 * Usage: node scripts/build-preview.mjs [out.html]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND = path.join(ROOT, 'frontend')
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'preview', 'opengym-preview.html'))

const SCREEN_W = 390
const SCREEN_H = 844

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: FRONTEND, ...opts })

/* The demo profile trains the starter plan and nothing else, so those are the only
 * exercises whose animations are worth their full weight. Read out of starter.js
 * rather than copied, so adding a lift to the starter plan animates it here too. */
function demoExerciseIds() {
  const src = fs.readFileSync(path.join(FRONTEND, 'src/lib/starter.js'), 'utf8')
  const spec = src.slice(src.indexOf('const SPEC'), src.indexOf('starterRoutines'))
  const ids = [...spec.matchAll(/'(\d{4})'/g)].map(m => m[1])
  if (!ids.length) throw new Error('no exercise ids found in starter.js — did SPEC move?')
  return [...new Set(ids)]
}

/* src/instr swapped for empty packs. i18n.js looks every pack up through
 * import.meta.glob and throws if one is missing — and its catch clears the UI
 * dictionary too, so a missing pack would cost the translations as well as the
 * instructions. Empty packs keep every language switchable. */
function withStubbedInstructions(fn) {
  const dir = path.join(FRONTEND, 'src/instr')
  const stash = dir + '.orig'
  if (fs.existsSync(stash)) throw new Error(`${stash} already exists — a previous run left it behind`)
  fs.renameSync(dir, stash)
  try {
    fs.mkdirSync(dir)
    for (const f of fs.readdirSync(stash)) {
      fs.writeFileSync(path.join(dir, f), 'export default {}\n')
    }
    return fn()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(stash, dir)
  }
}

/* Text bound for an inline <script>. The HTML tokenizer stops at `</script`
 * wherever it appears, including inside a JS string, and `<!--` puts it into a
 * state where the real closing tag stops working — and this bundle contains both,
 * because plan-share.js builds a printable HTML document out of template literals.
 * A backslash in front of each is a no-op once JS parses the string back. */
const inlineSafe = js => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')

/* The built index.html plus its one JS and one CSS file, folded into a single
 * document. The manifest and icon links go: they point at files that will not be
 * there, and a preview has nothing to install.
 *
 * Order matters. Every edit that anchors on the page's own markup happens while
 * this is still the 900-byte shell: once the bundle is inlined, the document
 * contains a whole second HTML document as string data — `</head>` included — and
 * an anchor like that lands in the middle of the JavaScript. */
function inlineBundle(distDir, mediaJs) {
  let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
  const assets = fs.readdirSync(path.join(distDir, 'assets'))
  const js = assets.filter(f => f.endsWith('.js'))
  const css = assets.filter(f => f.endsWith('.css'))
  if (js.length !== 1) throw new Error(`expected exactly one JS chunk, got ${js.length}: ${js}`)

  const read = f => fs.readFileSync(path.join(distDir, 'assets', f), 'utf8')
  html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '')
  html = html.replace(/<link rel="(?:apple-touch-)?icon"[^>]*>\s*/g, '')

  // Both of these are classic scripts, so they run before the deferred module no
  // matter where they sit: the media map because exercises.js reads it as the
  // module evaluates, and the storage guard because the store writes to
  // localStorage on its first persist without guarding the call. Storage is
  // normally fine in an iframe; it throws in contexts that block site data, and
  // losing the preview to a thumbnailer is not worth the eight lines.
  const guard = `<script>(function(){try{var k='__p';localStorage.setItem(k,k);localStorage.removeItem(k)}catch(e){var m={};Object.defineProperty(window,'localStorage',{value:{getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}}})}})()</script>`
  html = html.replace('</head>', () => `${guard}<script>${inlineSafe(mediaJs)}</script></head>`)

  html = html.replace(/<link[^>]+href="[^"]*assets\/[^"]+\.css"[^>]*>/g, () =>
    `<style>${css.map(read).join('\n')}</style>`)
  html = html.replace(/<script[^>]+src="[^"]*assets\/[^"]+\.js"[^>]*><\/script>/, () =>
    `<script type="module">${inlineSafe(read(js[0]))}</script>`)
  return html
}

const fmtMB = bytes => (bytes / 1e6).toFixed(1) + ' MB'

function page(appHtml, stamp) {
  // The app document travels as a JS string rather than an srcdoc attribute: HTML
  // attribute escaping would have to quote every " in a megabyte of minified JS.
  // The </script guard is a no-op escape once the string is parsed back.
  const embedded = JSON.stringify(appHtml).replace(/<\/script/gi, '<\\/script')
  return `<title>BodyTransformation on a Phone</title>
<meta name="description" content="The BodyTransformation tracker running live in an iPhone chassis.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  /* Light is the base set; the two blocks after it redefine only tokens, so every
     component below styles through them and resolves in all three theme states. */
  :root {
    --ground: #e6e8e3;
    --panel: #f4f5f2;
    --edge: #cfd3ca;
    --ink: #1a1d18;
    --ink-2: #5f665a;
    --ink-3: #878e80;
    --accent: #4d6b21;
    --bezel: #2b2e29;
    --bezel-edge: #4a4e45;
    --nub: #babeb3;
    --shadow: 0 2px 4px rgba(26,29,24,.06), 0 24px 48px -12px rgba(26,29,24,.28);
  }
  :root:not([data-theme="light"]) {
    @media (prefers-color-scheme: dark) {
      --ground: #14160f;
      --panel: #1c1f18;
      --edge: #2f342a;
      --ink: #e9ece4;
      --ink-2: #9aa38f;
      --ink-3: #6f7767;
      --accent: #a8cf6b;
      --bezel: #050603;
      --bezel-edge: #33382c;
      --nub: #2a2e24;
      --shadow: 0 2px 4px rgba(0,0,0,.5), 0 28px 56px -12px rgba(0,0,0,.7);
    }
  }
  :root[data-theme="dark"] {
    --ground: #14160f;
    --panel: #1c1f18;
    --edge: #2f342a;
    --ink: #e9ece4;
    --ink-2: #9aa38f;
    --ink-3: #6f7767;
    --accent: #a8cf6b;
    --bezel: #050603;
    --bezel-edge: #33382c;
    --nub: #2a2e24;
    --shadow: 0 2px 4px rgba(0,0,0,.5), 0 28px 56px -12px rgba(0,0,0,.7);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: Archivo, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Spec-plate lettering: the small stamped labels on a piece of gym equipment. */
  .plate {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: .09em;
    text-transform: uppercase;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 20px;
    padding: 18px 24px 16px;
    border-bottom: 1px solid var(--edge);
  }
  header h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -.01em;
  }
  header h1 b { color: var(--accent); font-weight: 600; }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
    padding: 32px 24px 44px;
  }

  /* The chassis. Scale is set from the viewport height by the script at the end, so
     the whole phone stays visible on a laptop screen instead of running off it. */
  .rig {
    --scale: 1;
    width: calc((${SCREEN_W}px + 24px) * var(--scale));
    height: calc((${SCREEN_H}px + 24px) * var(--scale));
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }
  .phone {
    position: relative;
    flex: none;
    width: calc(${SCREEN_W}px + 24px);
    height: calc(${SCREEN_H}px + 24px);
    padding: 12px;
    border-radius: 56px;
    background: var(--bezel);
    box-shadow: inset 0 0 0 1px var(--bezel-edge), var(--shadow);
    transform: scale(var(--scale));
    transform-origin: top center;
  }
  .screen {
    width: ${SCREEN_W}px;
    height: ${SCREEN_H}px;
    border-radius: 44px;
    overflow: hidden;
    background: #000;
  }
  .screen iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  /* No notch or island: the app draws from the very top edge (there is no safe-area
     inset inside an iframe), so anything floating up there would sit on its header.
     The side hardware is what reads as a phone anyway. */
  .nub {
    position: absolute;
    background: var(--nub);
    border-radius: 2px;
  }
  .nub.power { right: -2px; top: 208px; width: 3px; height: 94px; }
  .nub.up { left: -2px; top: 176px; width: 3px; height: 58px; }
  .nub.down { left: -2px; top: 248px; width: 3px; height: 58px; }
  .nub.mute { left: -2px; top: 118px; width: 3px; height: 32px; }

  .notes {
    max-width: 62ch;
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: center;
  }
  .notes p { margin: 0; color: var(--ink-2); font-size: 14px; }
  .notes p b { color: var(--ink); font-weight: 600; }

  /* Reads as a row of equipment labels, and each item is a real fact about what is
     and is not wired up in this build — not decoration. */
  .facts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 2px;
  }
  .facts span {
    border: 1px solid var(--edge);
    background: var(--panel);
    border-radius: 3px;
    padding: 4px 9px;
  }
  .facts span.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--edge)); }

  a { color: var(--accent); }
  a:focus-visible, iframe:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  @media (max-width: 560px) {
    header { padding: 14px 16px; }
    main { padding: 20px 12px 32px; }
  }
</style>

<header>
  <h1>open<b>Gym</b> &mdash; live preview</h1>
  <div class="plate">build ${stamp}</div>
</header>

<main>
  <div class="rig" id="rig">
    <div class="phone">
      <div class="screen"><iframe id="app" title="BodyTransformation running in a phone-sized viewport"></iframe></div>
      <div class="nub mute"></div>
      <div class="nub up"></div>
      <div class="nub down"></div>
      <div class="nub power"></div>
    </div>
  </div>

  <div class="notes">
    <p>
      The real app, running for real &mdash; tap through it. It opens on a seeded
      example profile with four months of training behind it, so the charts, the
      heatmap and the progression targets all have something to say.
      <b>Start a workout from the tab bar</b> to see the guided flow.
    </p>
    <div class="facts plate">
      <span class="on">1324 exercises</span>
      <span class="on">progression engine</span>
      <span class="on">stats &amp; muscle map</span>
      <span class="on">12 languages</span>
      <span>animations: starter plan only</span>
      <span>no passkeys &mdash; no server here</span>
    </div>
  </div>
</main>

<script>
  document.getElementById('app').srcdoc = ${embedded};

  // Keep the whole chassis on screen without making the app's viewport a lie: the
  // iframe stays 390x844 and the phone is scaled visually around it.
  var rig = document.getElementById('rig');
  function fit() {
    var room = window.innerHeight - rig.getBoundingClientRect().top - 150;
    var scale = Math.max(0.4, Math.min(1, room / ${SCREEN_H + 24}));
    rig.style.setProperty('--scale', scale.toFixed(3));
  }
  fit();
  window.addEventListener('resize', fit);
</script>
`
}

/* ---------- build ---------- */

const mediaDir = path.join(ROOT, 'media')
if (!fs.existsSync(path.join(mediaDir, 'img'))) {
  console.error('media/img is empty — run `docker compose up media` or scripts/fetch-media.sh first')
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(ROOT, '.preview-'))
try {
  console.log('· exercise media')
  const mediaFile = path.join(tmp, 'media.js')
  run('python3', [path.join(ROOT, 'scripts/preview-media.py'), mediaDir, mediaFile, demoExerciseIds().join(',')])

  console.log('· vite build (demo, single chunk, instructions stubbed)')
  const distDir = path.join(tmp, 'dist')
  withStubbedInstructions(() =>
    run('npx', ['vite', 'build', '--config', 'vite.preview.config.js', '--outDir', distDir, '--emptyOutDir'], {
      stdio: 'inherit',
      env: { ...process.env, VITE_DEMO: '1' }
    })
  )

  console.log('· inlining')
  const appHtml = inlineBundle(distDir, fs.readFileSync(mediaFile, 'utf8'))
  const stamp = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'package.json'), 'utf8')).version

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, page(appHtml, stamp))
  const size = fs.statSync(OUT).size
  console.log(`\n  ${OUT}\n  ${fmtMB(size)}`)
  // Artifacts cap the rendered page at 16 MB, and there is no partial failure —
  // it either publishes or it does not.
  if (size > 15.5e6) {
    console.error(`\n  too big to publish as an artifact (limit 16 MB)`)
    process.exit(1)
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
