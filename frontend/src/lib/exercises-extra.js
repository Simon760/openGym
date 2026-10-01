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
    // Its console shows metres, not km/h — see readoutOf.
    readout: 'dist',
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
  },
  {
    // A sport, not a gym movement, and the catalogue has none of those. Filed as cardio so it
    // is logged the way it is actually done — a duration and how hard it was — rather than in
    // sets and reps that a match does not have.
    id: 'x003',
    n: 'padel',
    fr: 'padel',
    bp: 'cardio',
    eq: 'body weight',
    tg: 'cardiovascular system',
    mg: 'quadriceps',
    // A racket sport is legs and rotation before it is arms: the lunges and the changes of
    // direction do most of the work, the trunk turns on every shot, and the shoulder and
    // forearm carry the racket. Spread wide on purpose — that is what the sport does.
    sm: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'core', 'obliques', 'shoulders', 'forearms'],
    // A match, not a count of matches: one block of minutes, and no Add set under it.
    once: true,
    desc: 'Aussi écrit paddle. Noté en durée et en effort, comme le reste du cardio.',
    st: [
      "Échauffe les épaules et les chevilles avant le premier échange : les appuis partent froid sinon.",
      "Compte le temps de jeu effectif, pas le temps passé au club.",
      "Note l'effort ressenti sur l'échelle RPE — un match tranquille et un match disputé n'ont pas le même coût.",
      "Si ta montre a compté la séance, saisis ses kcal au récap : elles priment sur toute estimation.",
      "Les kilomètres sont facultatifs — laisse le champ vide si rien ne les a mesurés."
    ]
  },
  // Sports, logged like padel above: a duration and how hard it was. Which muscles each one
  // loads and how its recovery is reckoned are in sports.js, with the studies behind them —
  // `sm` here only keeps the record in the catalogue's own vocabulary.
  {
    id: 'x004',
    n: 'football (soccer)',
    fr: 'football',
    bp: 'cardio',
    eq: 'body weight',
    tg: 'cardiovascular system',
    mg: 'hamstrings',
    sm: ['hamstrings', 'quadriceps', 'adductors', 'glutes', 'calves', 'hip flexors'],
    once: true,
    desc: 'Aussi : foot, soccer, futsal, foot à cinq, five.',
    st: [
      "Compte le temps de jeu, pas le temps passé au stade.",
      "Note l'effort de la séance sur 10 : un match disputé tourne autour de 7, un five tranquille autour de 4.",
      "Après un vrai match, le sprint et la force des jambes mettent 48 à 72 h à revenir : c'est ce que l'app compte pour la récupération.",
      "Si ta montre a compté la séance, saisis ses kcal : elles priment sur toute estimation."
    ]
  },
  {
    id: 'x005',
    n: 'swimming',
    fr: 'natation',
    bp: 'cardio',
    eq: 'body weight',
    tg: 'cardiovascular system',
    mg: 'lats',
    sm: ['lats', 'chest', 'shoulders', 'triceps', 'core'],
    once: true,
    readout: 'dist',
    desc: 'Aussi : nage, crawl, brasse, dos crawlé, piscine, longueurs.',
    st: [
      "Compte le temps passé à nager, pauses au bord comprises si elles étaient courtes.",
      "La distance est facultative, en kilomètres : 40 longueurs de 25 m font 1 km.",
      "Note l'effort de la séance sur 10.",
      "Si ta montre a compté la séance, saisis ses kcal : elles priment sur toute estimation."
    ]
  },
  {
    id: 'x006',
    n: 'tennis',
    fr: 'tennis',
    bp: 'cardio',
    eq: 'body weight',
    tg: 'cardiovascular system',
    mg: 'quadriceps',
    sm: ['quadriceps', 'calves', 'glutes', 'shoulders', 'chest', 'forearms', 'obliques'],
    once: true,
    desc: 'Simple ou double. Noté en durée et en effort, comme le padel.',
    st: [
      "Compte le temps de jeu effectif, échauffement compris.",
      "Note l'effort de la séance sur 10 : un double tranquille n'a pas le coût d'un simple disputé.",
      "Si ta montre a compté la séance, saisis ses kcal : elles priment sur toute estimation."
    ]
  },
  {
    id: 'x007',
    n: 'running (outdoor)',
    fr: 'course à pied',
    bp: 'cardio',
    eq: 'body weight',
    tg: 'cardiovascular system',
    mg: 'calves',
    sm: ['calves', 'quadriceps', 'glutes', 'hamstrings'],
    once: true,
    readout: 'dist',
    desc: 'Aussi : footing, jogging, running, trail, course.',
    st: [
      "Compte la durée de la sortie.",
      "La distance est facultative, en kilomètres.",
      "Note l'effort sur 10 : un footing facile tourne autour de 3, une course ou un fractionné à 7 ou plus.",
      "Si ta montre a compté la séance, saisis ses kcal : elles priment sur toute estimation."
    ]
  },
  {
    id: 'x008',
    n: 'cycling (outdoor)',
    fr: 'vélo',
    bp: 'cardio',
    eq: 'body weight',
    tg: 'cardiovascular system',
    mg: 'quadriceps',
    sm: ['quadriceps', 'glutes', 'calves', 'hamstrings'],
    once: true,
    readout: 'dist',
    desc: 'Aussi : cyclisme, vélo de route, VTT, gravel, vélotaf.',
    st: [
      "Compte la durée de la sortie, arrêts longs exclus.",
      "La distance est facultative, en kilomètres.",
      "Note l'effort sur 10.",
      "Si ta montre a compté la séance, saisis ses kcal : elles priment sur toute estimation."
    ]
  }
]
