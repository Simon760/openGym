// The product name, in one place.
//
// It appears in the window title, the home header, the sign-in screen, every export filename
// and the first line of every digest — and a name that lives in eleven of those places drifts
// the first time it changes. The wire formats deliberately do not use it: the storage key,
// the service-worker cache and the bundle identifier are identities, not labels, and renaming
// one of those would orphan the data behind it.
//
// This app is a fork of openGym (AGPL-3.0) by DuarteSantos8. The licence requires that
// attribution survive the rename, which is why UPSTREAM is here rather than deleted.
export const APP_NAME = 'BodyEvolve'
export const UPSTREAM = 'openGym'
export const UPSTREAM_REPO = 'https://github.com/DuarteSantos8/openGym'

// Lowercase, hyphen-safe: what an exported backup or plan file is called on disk.
export const FILE_PREFIX = 'bodyevolve'
