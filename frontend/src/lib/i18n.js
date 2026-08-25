// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise instructions come from separately generated packs in src/instr/ (one per
// language, from the upstream dataset) — also lazy-loaded on language switch.
import { useSyncExternalStore } from 'react'
// Bundled, not fetched: see ONLY_LANG below for why the one language it ships in is static.
import ONE_DICT from '../locales/fr.js'

// UI languages. de/pt have no instruction pack upstream — instructions fall back to English.
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

/**
 * The language this build ships in, and the only one it will speak. Set it to null for the
 * multilingual build with a picker in Settings.
 *
 * It is a build-time decision rather than a setting, and that buys three things a default
 * could not. The strings are bundled instead of fetched, so the first paint is already in the
 * right language — a default still has to await a dynamic import, and the app flashes English
 * on every cold start while it does. A profile that stored another language is coerced rather
 * than obeyed, so an account made before this change does not come back in English. And the
 * ten unused locales and their instruction packs fall out of the build entirely, because
 * nothing references them any more.
 */
export const ONLY_LANG = 'fr'

// Referenced only on the multilingual path, so with ONLY_LANG set these fold away and their
// chunks are never emitted.
const localePacks = ONLY_LANG ? null : import.meta.glob('../locales/*.js')
const instrPacks = ONLY_LANG ? null : import.meta.glob('../instr/*.js')

// The suite asserts on source strings — the keys themselves — and on English number
// formatting. A bundled dictionary would quietly rewrite both and turn every content test
// into a translation test, so under test the language stays unset and t() falls through to
// its own key, exactly as the English build does.
const TESTING = import.meta.env.MODE === 'test'

let lang = TESTING ? 'en' : ONLY_LANG || 'en'
let dict = TESTING || !ONLY_LANG ? {} : ONE_DICT
let instr = null            // { exId: [steps] } for the current language, null = English
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

export async function setLang(l) {
  // One language: the strings are already in `dict`, so only the exercise instructions have to
  // be fetched — 700 kB of them, which is why they stay lazy while the UI strings do not.
  if (ONLY_LANG && !TESTING) {
    if (version > 0) return
    try { instr = (await import('../instr/fr.js')).default } catch (e) { instr = null }
    notify()
    return
  }
  if (!LANGS[l]) l = 'en'
  if (l === lang && version > 0) return
  lang = l
  try {
    dict = l === 'en' ? {} : (await localePacks['../locales/' + l + '.js']()).default
    instr = l === 'en' || !INSTR_LANGS.includes(l) ? null : (await instrPacks['../instr/' + l + '.js']()).default
  } catch (e) { dict = {}; instr = null }
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
