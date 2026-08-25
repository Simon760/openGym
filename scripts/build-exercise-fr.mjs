#!/usr/bin/env node
/* Generate frontend/src/names/fr.js — the catalogue's names, in French.
 *
 *   node scripts/build-exercise-fr.mjs [--misses]
 *
 * Upstream translates the instruction steps into ten languages and the names into none, so
 * these are built here. Not word by word: the names are compositional and French does not
 * order them the same way. "dumbbell incline bench press" is a head ("bench press"), a
 * modifier ("incline") and a piece of equipment ("dumbbell"), and French wants them as
 * "développé incliné haltères" — head first, modifier agreeing with it, equipment last.
 * So the tables below are head nouns with a gender, modifiers with their agreements, and
 * equipment as a bare noun the way it is said in a gym.
 *
 * The gate is the point: a name is only translated when EVERY word of it was consumed by a
 * rule. A partial match is dropped and the English name stands, because half-translated
 * French reads worse than English and, unlike English, cannot be trusted. Run with --misses
 * to see what is still falling through, which is how the tables get extended.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ---------------------------------------------------------------- vocabulary -- */

// Movement heads. `g` is gender and number, for the modifiers that follow: m, f, mp, fp.
const HEADS = {
  'bench press': ['développé couché', 'm'],
  'chest press': ['développé pectoraux', 'm'],
  'shoulder press': ['développé épaules', 'm'],
  'military press': ['développé militaire', 'm'],
  'overhead press': ['développé militaire', 'm'],
  'push press': ['développé jeté', 'm'],
  'leg press': ['presse à cuisses', 'f'],
  press: ['développé', 'm'],

  'biceps curl': ['curl biceps', 'm'],
  'hammer curl': ['curl marteau', 'm'],
  'preacher curl': ['curl au pupitre', 'm'],
  'concentration curl': ['curl concentration', 'm'],
  'wrist curl': ['curl poignets', 'm'],
  'leg curl': ['leg curl', 'm'],
  'drag curl': ['drag curl', 'm'],
  'spider curl': ['curl spider', 'm'],
  'zottman curl': ['curl Zottman', 'm'],
  curl: ['curl', 'm'],

  'upright row': ['rowing menton', 'm'],
  'renegade row': ['renegade row', 'm'],
  'rear delt row': ['rowing deltoïdes postérieurs', 'm'],
  row: ['rowing', 'm'],
  pulldown: ['tirage vertical', 'm'],
  'pull down': ['tirage vertical', 'm'],
  pushdown: ['extension triceps poulie', 'f'],
  'push down': ['extension triceps poulie', 'f'],
  pullover: ['pullover', 'm'],
  'face pull': ['face pull', 'm'],

  'lateral raise': ['élévation latérale', 'f'],
  'front raise': ['élévation frontale', 'f'],
  'calf raise': ['extension mollets', 'f'],
  'leg raise': ['relevé de jambes', 'm'],
  'knee raise': ['relevé de genoux', 'm'],
  'hip raise': ['relevé de bassin', 'm'],
  'shoulder raise': ['élévation épaules', 'f'],
  raise: ['élévation', 'f'],

  'front squat': ['squat avant', 'm'],
  'hack squat': ['hack squat', 'm'],
  'sissy squat': ['sissy squat', 'm'],
  'split squat': ['squat fendu', 'm'],
  'goblet squat': ['goblet squat', 'm'],
  'sumo squat': ['squat sumo', 'm'],
  'pistol squat': ['pistol squat', 'm'],
  squat: ['squat', 'm'],

  'romanian deadlift': ['soulevé de terre roumain', 'm'],
  'sumo deadlift': ['soulevé de terre sumo', 'm'],
  'stiff leg deadlift': ['soulevé de terre jambes tendues', 'm'],
  'straight leg deadlift': ['soulevé de terre jambes tendues', 'm'],
  deadlift: ['soulevé de terre', 'm'],

  'triceps extension': ['extension triceps', 'f'],
  'leg extension': ['leg extension', 'm'],
  'back extension': ['extension lombaires', 'f'],
  'hip extension': ['extension de hanche', 'f'],
  extension: ['extension', 'f'],

  'rear delt fly': ['écarté deltoïdes postérieurs', 'm'],
  fly: ['écarté', 'm'],
  flye: ['écarté', 'm'],
  crossover: ['écarté poulie vis-à-vis', 'm'],

  'reverse crunch': ['crunch inversé', 'm'],
  crunch: ['crunch', 'm'],
  'sit-up': ['relevé de buste', 'm'],
  situp: ['relevé de buste', 'm'],
  'russian twist': ['russian twist', 'm'],
  twist: ['rotation du buste', 'f'],
  plank: ['planche', 'f'],
  'mountain climber': ['mountain climber', 'm'],
  'leg pull in': ['ramené de jambes', 'm'],
  'v-up': ['v-up', 'm'],
  'jackknife sit-up': ['jackknife', 'm'],
  rollerout: ['roue abdominale', 'f'],
  'roll-out': ['roue abdominale', 'f'],

  'push-up': ['pompes', 'fp'],
  pushup: ['pompes', 'fp'],
  'pull-up': ['tractions', 'fp'],
  pullup: ['tractions', 'fp'],
  'chin-up': ['tractions supination', 'fp'],
  'triceps dip': ['dips triceps', 'mp'],
  'chest dip': ['dips pectoraux', 'mp'],
  dip: ['dips', 'mp'],
  dips: ['dips', 'mp'],
  'skull crusher': ['barre au front', 'f'],
  kickback: ['kickback', 'm'],
  shrug: ['haussement d’épaules', 'm'],
  lunge: ['fente', 'f'],
  'step-up': ['step-up', 'm'],
  'hip thrust': ['hip thrust', 'm'],
  'good morning': ['good morning', 'm'],
  clean: ['épaulé', 'm'],
  snatch: ['arraché', 'm'],
  'clean and jerk': ['épaulé-jeté', 'm'],
  'clean and press': ['épaulé-développé', 'm'],
  thruster: ['thruster', 'm'],
  burpee: ['burpees', 'mp'],
  bridge: ['pont', 'm'],
  'glute bridge': ['pont fessier', 'm'],
  stretch: ['étirement', 'm'],
  rotation: ['rotation', 'f'],
  'external rotation': ['rotation externe', 'f'],
  'internal rotation': ['rotation interne', 'f'],
  'wood chop': ['wood chop', 'm'],
  'jumping jack': ['jumping jacks', 'mp'],
  'hyperextension': ['hyperextension', 'f'],
  'inverted row': ['rowing inversé', 'm'],
  'muscle up': ['muscle-up', 'm'],
  'sled press': ['presse traîneau', 'f'],
  'wrist rotation': ['rotation des poignets', 'f'],
  'hanging leg raise': ['relevé de jambes suspendu', 'm'],
  'side bend': ['flexion latérale', 'f'],
  'toe touch': ['toucher d’orteils', 'm'],
  'heel touch': ['toucher de talons', 'm'],
  'toe touchers': ['touchers d’orteils', 'mp'],
  'heel touchers': ['touchers de talons', 'mp'],
  circles: ['cercles', 'mp'],
  'pull through': ['pull through', 'm'],
  'pallof press': ['pallof press', 'm'],
  'rack pull': ['rack pull', 'm'],
  'pin press': ['pin press', 'm'],
  'pendlay row': ['rowing Pendlay', 'm'],
  'box jump': ['saut sur box', 'm'],
  'y-raise': ['élévation en Y', 'f'],
  'jack knife sit-up': ['jackknife', 'm'],
  'jackknife': ['jackknife', 'm'],
  'bear crawl': ['bear crawl', 'm'],
  'battling ropes': ['battle ropes', 'fp'],
  'leg lift': ['relevé de jambes', 'm'],
  'hip lift': ['relevé de bassin', 'm'],
  'calf press': ['presse mollets', 'f'],
  'rollerout': ['roue abdominale', 'f'],
  'ab rollerout': ['roue abdominale', 'f'],
  'wheel rollerout': ['roue abdominale', 'f'],
  'leg pull in': ['ramené de jambes', 'm'],
  'flutter kick': ['battements de jambes', 'mp'],
  'scissor kick': ['ciseaux', 'mp'],
  'high knee': ['montées de genoux', 'fp'],
  'squat row': ['rowing en squat', 'm'],
  'good morning': ['good morning', 'm'],
  'front lever': ['front lever', 'm'],
  'back lever': ['back lever', 'm'],
  planche: ['planche', 'f'],
  'l-sit': ['L-sit', 'm'],
  'wall sit': ['chaise au mur', 'f'],
  'hip abduction': ['abduction de hanche', 'f'],
  'hip adduction': ['adduction de hanche', 'f'],
  abduction: ['abduction', 'f'],
  adduction: ['adduction', 'f'],
  'bicycle crunch': ['crunch bicyclette', 'm'],
  'air bike': ['bicyclette', 'f'],
  'donkey calf raise': ['mollets âne', 'mp'],
  'curl-up': ['curl-up', 'm'],
  'body-up': ['body-up', 'm'],
  'butt-up': ['butt-up', 'm'],
  'bottoms-up': ['bottoms-up', 'm'],
  'sit up': ['relevé de buste', 'm'],
  'push up': ['pompes', 'fp'],
  'pull up': ['tractions', 'fp'],
  'chin up': ['tractions supination', 'fp'],
  'step up': ['step-up', 'm'],
  'v up': ['v-up', 'm'],
  'sled press': ['presse traîneau', 'f'],
  'sled row': ['tirage traîneau', 'm'],
}

// Modifiers, with their agreements. A string is a fixed phrase that never agrees.
const MODS = {
  incline: ['incliné', 'inclinée', 'inclinés', 'inclinées'],
  decline: ['décliné', 'déclinée', 'déclinés', 'déclinées'],
  reverse: ['inversé', 'inversée', 'inversés', 'inversées'],
  seated: 'assis',
  standing: 'debout',
  lying: ['allongé', 'allongée', 'allongés', 'allongées'],
  kneeling: 'à genoux',
  'bent over': ['penché', 'penchée', 'penchés', 'penchées'],
  'bent-over': ['penché', 'penchée', 'penchés', 'penchées'],
  hanging: ['suspendu', 'suspendue', 'suspendus', 'suspendues'],
  weighted: ['lesté', 'lestée', 'lestés', 'lestées'],
  assisted: ['assisté', 'assistée', 'assistés', 'assistées'],
  alternate: ['alterné', 'alternée', 'alternés', 'alternées'],
  alternating: ['alterné', 'alternée', 'alternés', 'alternées'],
  jump: ['sauté', 'sautée', 'sautés', 'sautées'],
  jumping: ['sauté', 'sautée', 'sautés', 'sautées'],
  walking: ['marché', 'marchée', 'marchés', 'marchées'],
  twisting: 'avec rotation',
  'one arm': 'à un bras',
  'single arm': 'à un bras',
  'one-arm': 'à un bras',
  'two arm': 'à deux bras',
  'one leg': 'à une jambe',
  'single leg': 'à une jambe',
  'one-leg': 'à une jambe',
  'close grip': 'prise serrée',
  'close-grip': 'prise serrée',
  'wide grip': 'prise large',
  'wide-grip': 'prise large',
  'narrow grip': 'prise serrée',
  'neutral grip': 'prise neutre',
  'reverse grip': 'prise inversée',
  'underhand grip': 'en supination',
  'overhand grip': 'en pronation',
  underhand: 'en supination',
  overhand: 'en pronation',
  supinated: 'en supination',
  pronated: 'en pronation',
  'behind neck': 'nuque',
  'behind the neck': 'nuque',
  'behind back': 'derrière le dos',
  overhead: 'au-dessus de la tête',
  'straight arm': 'bras tendus',
  'straight leg': 'jambes tendues',
  'bent knee': 'genoux fléchis',
  'bent leg': 'jambes fléchies',
  'on floor': 'au sol',
  floor: 'au sol',
  prone: 'à plat ventre',
  supine: 'sur le dos',
  side: ['latéral', 'latérale', 'latéraux', 'latérales'],
  lateral: ['latéral', 'latérale', 'latéraux', 'latérales'],
  front: 'avant',
  rear: 'arrière',
  back: 'arrière',
  high: ['haut', 'haute', 'hauts', 'hautes'],
  low: ['bas', 'basse', 'bas', 'basses'],
  full: ['complet', 'complète', 'complets', 'complètes'],
  half: 'demi',
  wide: ['large', 'large', 'larges', 'larges'],
  single: ['unilatéral', 'unilatérale', 'unilatéraux', 'unilatérales'],
  'iso-lateral': ['unilatéral', 'unilatérale', 'unilatéraux', 'unilatérales'],
  'iso lateral': ['unilatéral', 'unilatérale', 'unilatéraux', 'unilatérales'],
  cross: ['croisé', 'croisée', 'croisés', 'croisées'],
  triceps: 'triceps',
  biceps: 'biceps',
  chest: 'pectoraux',
  shoulder: 'épaules',
  glute: 'fessiers',
  calf: 'mollets',
  hip: 'hanche',
  neck: 'nuque',
  oblique: 'obliques',
  wrist: 'poignets',
  ankle: 'chevilles',
  quadriceps: 'quadriceps',
  hamstring: 'ischio-jambiers',
  'rear delt': 'deltoïdes postérieurs',
  lat: 'dorsaux',
  lats: 'dorsaux',
  'upper body': 'haut du corps',
  bulgarian: ['bulgare', 'bulgare', 'bulgares', 'bulgares'],
  romanian: ['roumain', 'roumaine', 'roumains', 'roumaines'],
  sumo: 'sumo',
  arnold: 'Arnold',
  scott: 'Scott',
  spider: 'spider',
  zercher: 'Zercher',
  zottman: 'Zottman',
  drag: 'drag',
  gorilla: 'gorille',
  frog: 'grenouille',
  butterfly: 'butterfly',
  power: 'force',
  isometric: ['isométrique', 'isométrique', 'isométriques', 'isométriques'],
  static: ['statique', 'statique', 'statiques', 'statiques'],
  dynamic: ['dynamique', 'dynamique', 'dynamiques', 'dynamiques'],
  explosive: ['explosif', 'explosive', 'explosifs', 'explosives'],
  slow: ['lent', 'lente', 'lents', 'lentes'],
  wall: 'au mur',
  bench: 'sur banc',
  chair: 'sur chaise',
  box: 'sur box',
  step: 'sur step',
  'stability ball': 'swiss ball',
  'exercise ball': 'swiss ball',
  'medicine ball': 'médecine-ball',
  'bosu ball': 'bosu',
  ball: 'ballon',
  narrow: ['serré', 'serrée', 'serrés', 'serrées'],
  parallel: ['parallèle', 'parallèle', 'parallèles', 'parallèles'],
  archer: 'archer',
  'all fours': 'à quatre pattes',
  'side lying': 'allongé sur le côté',
  'palms down': 'paumes vers le bas',
  'palms up': 'paumes vers le haut',
  'palms in': 'paumes face à face',
  sitted: 'assis',
  revers: ['inversé', 'inversée', 'inversés', 'inversées'],
  squatting: 'en squat',
  bicep: 'biceps',
  tricep: 'triceps',
  calves: 'mollets',
  glutes: 'fessiers',
  quads: 'quadriceps',
  hamstrings: 'ischio-jambiers',
  abs: 'abdominaux',
  abdominal: 'abdominaux',
  pec: 'pectoraux',
  pecs: 'pectoraux',
  'pectoralis major': 'grand pectoral',
  'rectus femoris': 'droit fémoral',
  piriformis: 'piriforme',
  gluteus: 'fessiers',
  adductor: 'adducteurs',
  adductors: 'adducteurs',
  abductor: 'abducteurs',
  obliques: 'obliques',
  'lower back': 'lombaires',
  'upper back': 'haut du dos',
  'inner thigh': 'intérieur de cuisse',
  'outer thigh': 'extérieur de cuisse',
  guillotine: 'guillotine',
  jefferson: 'Jefferson',
  bradford: 'Bradford',
  'high bar': 'barre haute',
  'low bar': 'barre basse',
  'clean-grip': 'prise arraché',
  'close-grip': 'prise serrée',
  'wide-stance': 'stance large',
  'narrow stance': 'stance serrée',
  'wide stance': 'stance large',
  speed: ['rapide', 'rapide', 'rapides', 'rapides'],
  drop: ['sauté', 'sautée', 'sautés', 'sautées'],
  backward: 'arrière',
  forward: 'avant',
  vertical: ['vertical', 'verticale', 'verticaux', 'verticales'],
  horizontal: ['horizontal', 'horizontale', 'horizontaux', 'horizontales'],
  'bent arm': 'bras fléchis',
  'straight back': 'dos droit',
  'stiff leg': 'jambes tendues',
  'rocking': 'balancé',
  'yoga pose': 'posture de yoga',
  'skier': 'skieur',
  'crawl': 'crawl',
  'up': 'haut',
  'down': 'bas',
  // push-up and pull-up variants: a small closed set that unlocks a lot of the catalogue
  clap: ['claqué', 'claquée', 'claqués', 'claquées'],
  diamond: 'diamant',
  deep: ['profond', 'profonde', 'profonds', 'profondes'],
  pike: 'pike',
  clock: 'horloge',
  spiderman: 'spiderman',
  hindu: 'hindou',
  staggered: ['décalé', 'décalée', 'décalés', 'décalées'],
  plyo: 'plyo',
  handstand: 'en poirier',
  commando: 'commando',
  typewriter: 'typewriter',
  kipping: 'kipping',
  'chest tap': 'tape poitrine',
  'shoulder tap': 'tape épaule',
  'wide hand': 'mains larges',
  'close hand': 'mains serrées',
  'knee': 'genoux',
  'flexion leg': 'jambes fléchies',
  'straight arm': 'bras tendus',
  '3/4': 'trois quarts',
  'arms overhead': 'bras au-dessus de la tête',
  'arms apart': 'bras écartés',
  'elbow': 'coude',
  'inverse': ['inversé', 'inversée', 'inversés', 'inversées'],
  'inverted': ['inversé', 'inversée', 'inversés', 'inversées'],
  'lean': ['penché', 'penchée', 'penchés', 'penchées'],
  'bosu': 'bosu',
  'ring': 'anneaux',
  'rings': 'anneaux',
  'ez': 'EZ',
  'olympic': ['olympique', 'olympique', 'olympiques', 'olympiques'],
  'v-bar': 'barre en V',
  'straight bar': 'barre droite',
  'rope': 'corde',
  'lat': 'dorsaux',
  'balance': 'équilibre',
  'stabilization': 'stabilisation',
  'salute': 'salut',
  'shoulder-width': 'largeur d’épaules',
  'palm up': 'paume vers le haut',
  'palm down': 'paume vers le bas',
  'crossovers': 'croisés',
  'squat jump': 'squat sauté',
}

// Equipment, said the way a gym says it. Body weight is the default and stays unsaid.
const EQUIP = {
  dumbbell: 'haltères',
  barbell: 'barre',
  'ez barbell': 'barre EZ',
  'ez-barbell': 'barre EZ',
  'olympic barbell': 'barre olympique',
  'trap bar': 'trap bar',
  cable: 'poulie',
  'leverage machine': 'machine',
  lever: 'machine',
  'smith machine': 'Smith machine',
  smith: 'Smith machine',
  band: 'élastique',
  'resistance band': 'élastique',
  kettlebell: 'kettlebell',
  'sled machine': 'traîneau',
  sled: 'traîneau',
  rope: 'corde',
  roller: 'roue',
  'wheel roller': 'roue abdominale',
  'stability ball': 'swiss ball',
  'exercise ball': 'swiss ball',
  'medicine ball': 'médecine-ball',
  'bosu ball': 'bosu',
  hammer: 'marteau',
  tire: 'pneu',
  'body weight': '',
  bodyweight: '',
  weighted: '',
  assisted: '',
}

// What hangs off "on a bench", "with a towel", "over an exercise ball". The dataset uses
// these constantly and every one of them used to block a whole name.
const PROPS = {
  'exercise ball': 'swiss ball',
  'stability ball': 'swiss ball',
  'medicine ball': 'médecine-ball',
  'bosu ball': 'bosu',
  ball: 'ballon',
  bench: 'banc',
  'a bench': 'banc',
  'the bench': 'banc',
  'flat bench': 'banc plat',
  'incline bench': 'banc incliné',
  floor: 'sol',
  'the floor': 'sol',
  wall: 'mur',
  'the wall': 'mur',
  chair: 'chaise',
  box: 'box',
  step: 'step',
  towel: 'serviette',
  'a towel': 'serviette',
  rope: 'corde',
  'rope attachment': 'corde',
  'v-bar': 'barre en V',
  'v-bar attachment': 'barre en V',
  'straight bar': 'barre droite',
  'straight bar attachment': 'barre droite',
  'arm blaster': 'arm blaster',
  'ez bar': 'barre EZ',
  bar: 'barre',
  'one leg': 'une jambe',
  'both legs': 'deux jambes',
  'two legs': 'deux jambes',
  knees: 'genoux',
  'knees bent': 'genoux fléchis',
  'hip': 'hanche',
  'throw down': 'lancer',
  'lateral throw down': 'lancer latéral',
  'stability ball between knees': 'swiss ball entre les genoux',
  'band under both legs': 'élastique sous les deux jambes',
  'support': 'support',
}
const PREP = { on: 'sur', over: 'sur', with: 'avec', using: 'avec', at: 'à', in: 'en', under: 'sous' }

// Trailing parentheticals the dataset uses to separate near-duplicates.
const NOTES = {
  male: 'homme',
  female: 'femme',
  ball: 'ballon',
  rope: 'corde',
  'rope attachment': 'à la corde',
  kneeling: 'à genoux',
  'straight bar': 'barre droite',
  'grip): ': '',
  bar: 'barre',
  towel: 'serviette',
  pov: '',
  'blaster': 'blaster',
  'arm blaster': 'arm blaster',
  'vertical': 'vertical',
  'plyo box': 'box',
  'on knees': 'à genoux',
  'side': 'de côté',
  'wide grip': 'prise large',
  'close grip': 'prise serrée',
}

/* --------------------------------------------------------------- translation -- */

// French puts these after everything else — "curl biceps haltères assis" reads right,
// "curl assis biceps haltères" does not. Adjectives that agree come first, then the grip and
// limb phrases, then the equipment, then the posture.
const POSTURE = new Set(['seated', 'sitted', 'standing', 'lying', 'side lying', 'kneeling',
  'bent over', 'bent-over', 'hanging', 'all fours', 'prone', 'supine', 'squatting',
  'on floor', 'floor', 'wall', 'bench', 'chair', 'box', 'step'])

const IDX = { m: 0, f: 1, mp: 2, fp: 3 }
const agree = (mod, g) => (typeof mod === 'string' ? mod : mod[IDX[g] ?? 0])

// Longest phrase first, so "bench press" is never eaten by "press".
const byLength = obj => Object.keys(obj).sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length)
const HEAD_KEYS = byLength(HEADS)
const MOD_KEYS = byLength(MODS)
const EQ_KEYS = byLength(EQUIP)

const words = s => s.split(/\s+/).filter(Boolean)

/** Take `phrase` out of the word list if it is there, and say whether it was. */
function take(list, phrase) {
  const p = words(phrase)
  for (let i = 0; i <= list.length - p.length; i++) {
    if (p.every((w, j) => list[i + j] === w)) { list.splice(i, p.length); return true }
  }
  return false
}

/** The same, ignoring how the dataset happened to hyphenate it. */
const bare = w => w.replace(/-/g, ' ')
function takeFlat(list, phrase) {
  const p = words(phrase)
  // One hyphenated token standing for the whole phrase — "close-grip" for "close grip".
  // Checked over the whole list and not inside the span loop below, whose bound excludes
  // i entirely once the list is shorter than the phrase, which is exactly this case.
  const joined = p.join(' ')
  if (p.length > 1) for (let i = 0; i < list.length; i++) {
    if (bare(list[i]) === joined) { list.splice(i, 1); return true }
  }
  for (let i = 0; i <= list.length - p.length; i++) {
    if (p.every((w, j) => bare(list[i + j]) === p[j])) { list.splice(i, p.length); return true }
  }
  return false
}

export function toFrench(name) {
  let s = String(name).toLowerCase().trim().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ')

  // "v. 2" — the dataset's way of numbering near-identical entries. Taken off first: it can
  // sit *after* a parenthetical ("… (band under both legs) v. 2"), so a paren rule anchored
  // at the end never sees the paren while this is still there.
  let variant = ''
  const v = s.match(/\s+v\.?\s*(\d+)$/)
  if (v) { variant = 'variante ' + v[1]; s = s.slice(0, v.index).trim() }

  // "(male)", "(rope attachment)" — a note about the variant, not part of the movement.
  let note = ''
  const paren = s.match(/\s*[-\s]*\(([^)]*)\)\s*$/)
  if (paren) {
    const key = paren[1].trim()
    const known = key in NOTES ? NOTES[key] : key in PROPS ? PROPS[key] : null
    if (known === null) return null
    note = known
    s = s.slice(0, paren.index).trim()
  }

  // "on an exercise ball", "with a towel", "over a bench" — a prop, not part of the
  // movement, and the single most common reason a name used to be left in English.
  let prop = ''
  const prep = s.match(/\s+(on|over|with|using|under)\s+(?:a|an|the)?\s*([a-z0-9 -]+)$/)
  if (prep && PREP[prep[1]]) {
    const obj = prep[2].trim()
    if (obj in PROPS) { prop = PREP[prep[1]] + ' ' + PROPS[obj]; s = s.slice(0, prep.index).trim() }
  }

  const list = words(s)

  // Equipment first: it is almost always the leading word, and taking it out early stops
  // "cable" being read as a modifier and "hammer" as a curl variant when it is a machine.
  let equip = null
  for (const k of EQ_KEYS) {
    if (words(k).every((w, j) => list[j] === w)) { list.splice(0, words(k).length); equip = EQUIP[k]; break }
  }

  // Then the head — the movement itself. Without one there is nothing to translate. The
  // dataset writes the same movement hyphenated, spaced and pluralised ("pull-up", "pull
  // up", "pull-ups"), so the list is normalised rather than the table triplicated.
  const flat = list.join(' ').replace(/-/g, ' ')
  let head = null, gender = 'm'
  for (const k of HEAD_KEYS) {
    const key = k.replace(/-/g, ' ')
    if (takeFlat(list, key) || takeFlat(list, key + 's') || takeFlat(list, key + 'es')) {
      ;[head, gender] = HEADS[k]; break
    }
  }
  if (!head) return null
  void flat

  // Whatever is left has to be modifiers, all of them. One unknown word and the name is
  // left in English rather than shipped with a hole in it.
  const adj = [], phrases = [], posture = []
  const seen = new Set()
  let guard = 0
  while (list.length && guard++ < 20) {
    const before = list.length
    for (const k of MOD_KEYS) {
      if (!takeFlat(list, k.replace(/-/g, ' '))) continue
      const fr = agree(MODS[k], gender)
      seen.add(k)
      ;(POSTURE.has(k) ? posture : Array.isArray(MODS[k]) ? adj : phrases).push(fr)
      break
    }
    if (list.length === before) return null
  }

  // "développé couché incliné" is not a thing: couché *is* the flat one. Naming the angle
  // replaces it rather than stacking on it.
  if (head === 'développé couché' && (seen.has('incline') || seen.has('decline'))) head = 'développé'

  // "squat barre haute barre" — the equipment is already in the name.
  const so_far = [head, ...adj, ...phrases].join(' ')
  const eq = equip && !so_far.includes(equip) ? equip : ''

  return [head, ...adj, ...phrases, eq, ...posture, prop, note, variant]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------- emit -- */

if (process.argv[1] && process.argv[1].endsWith('build-exercise-fr.mjs')) {
  const src = readFileSync(join(ROOT, 'frontend/src/lib/exercises-data.js'), 'utf8')
  const db = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1))

  const out = {}
  const misses = []
  for (const e of db) {
    const fr = toFrench(e.n)
    if (fr && fr.toLowerCase() !== e.n.toLowerCase()) out[e.id] = fr
    else misses.push(e.n)
  }

  const file = join(ROOT, 'frontend/src/names/fr.js')
  writeFileSync(file, '// generated by scripts/build-exercise-fr.mjs — do not edit\n' +
    'export default ' + JSON.stringify(out) + '\n')
  const pct = (Object.keys(out).length / db.length * 100).toFixed(1)
  console.log(`${Object.keys(out).length}/${db.length} names translated (${pct}%) -> ${file}`)
  if (process.argv.includes('--misses')) {
    console.log('\n--- not translated, English stands ---')
    console.log(misses.slice(0, +(process.env.N || 80)).join('\n'))
  }
}
