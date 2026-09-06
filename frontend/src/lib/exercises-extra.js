/**
 * Exercises this app adds to the catalogue.
 *
 * exercises-data.js is vendored: scripts/build-instructions.mjs regenerates it from the
 * upstream dataset, and names/fr.js and instr/fr.js are generated from *that*. Anything
 * written into those four files is lost on the next refresh, so a movement upstream does
 * not carry lives here instead, with its own French name and its own French steps.
 *
 * The shape is the catalogue's own, field for field, because everything downstream reads
 * these records exactly like the other 1324:
 *   id  — prefixed `x`, so it can never collide with upstream's four digits or with a
 *         user's own exercise (`c` + uid)
 *   bp/eq/tg/mg/sm — the dataset's vocabulary, not free text: bp and eq drive the library's
 *         filter chips, and tg/sm are what muscles.js maps to the body map. A word outside
 *         that vocabulary silently drops the exercise off the map.
 *   st  — in French, unlike upstream's English, because instrFor() falls back to the
 *         record's own steps and the generated pack has no entry for an id it never saw.
 *         This build ships one language (i18n.js, ONLY_LANG).
 *   fr  — the display name; see exercises.js, which merges it into the generated table.
 * There is no img/gif: Media and Thumb already render an exercise that has none.
 */
export const EX_EXTRA = [
  {
    id: 'x001',
    n: 'dumbbell squeeze press',
    fr: 'squeeze press haltères',
    bp: 'chest',
    eq: 'dumbbell',
    tg: 'pectorals',
    mg: 'triceps',
    sm: ['triceps', 'shoulders'],
    st: [
      "Allonge-toi à plat sur un banc, un haltère dans chaque main, les paumes se faisant face.",
      "Colle les deux haltères l'un contre l'autre au-dessus de ta poitrine et presse-les fortement l'un vers l'autre.",
      "Sans relâcher cette pression, abaisse lentement les haltères jusqu'au milieu de la poitrine, les coudes près du corps.",
      "Marque une pause, puis repousse vers le haut en continuant de serrer les haltères l'un contre l'autre sur toute la remontée.",
      "Répète le nombre de répétitions souhaité."
    ]
  },
  {
    // Upstream has no fan bike at all, and the one thing it calls "air bike" (0003) is the
    // floor exercise — bicycle crunches — so searching for one led straight to abs.
    id: 'x002',
    n: 'assault bike',
    fr: 'assault bike',
    bp: 'cardio',
    eq: 'stationary bike',
    tg: 'cardiovascular system',
    mg: 'quadriceps',
    // Arms and legs both drive it, which is the whole point of the machine and the reason
    // it reads so much higher than a spin bike for the same minutes.
    sm: ['quadriceps', 'hamstrings', 'glutes', 'shoulders', 'back', 'core'],
    // The machine goes by four names depending on who made it, and exMatches searches this
    // field — so it is found by whichever one you happen to call it.
    desc: 'Aussi appelé air bike, fan bike, Airdyne ou Echo bike.',
    st: [
      "Règle la selle pour que ta jambe soit presque tendue en bas du pédalage.",
      "Assieds-toi, pieds sur les pédales, mains sur les poignées.",
      "Pousse et tire les poignées en même temps que tu pédales : les bras travaillent autant que les jambes.",
      "Garde le dos droit et le regard devant, sans t'écrouler sur le guidon.",
      "Tiens l'allure prévue, puis relâche progressivement plutôt que de t'arrêter net."
    ]
  }
]
