// Nanote version — single source of truth for the shipped version.
// CI asserts this matches package.json "version" before every release.
export const APP_VERSION = '1.0.0';

// Where the signed APKs are published. The "Check for updates" row in
// Settings opens this page (user-initiated only — the app itself never
// makes network requests).
export const RELEASES_URL = 'https://github.com/ahmedhaidr999-droid/Nanote-Web/releases';
