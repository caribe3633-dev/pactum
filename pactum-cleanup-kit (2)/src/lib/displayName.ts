/**
 * ══════════════════════════════════════════════════════════════════════
 * PACTUM · ENTITY DISPLAY NAMES — ONE RESOLVER, EVERY SURFACE
 * ══════════════════════════════════════════════════════════════════════
 *
 * Projects, sectors and companies all carry an Arabic name alongside the
 * English one. Roughly half the application read `nameEn` directly, so
 * switching to Arabic translated the chrome — buttons, labels, headings
 * — while every project, sector and company kept its English name.
 * Notifications, global search and the report headers were the worst
 * offenders.
 *
 * The rule, in one place:
 *
 *     Arabic UI  ->  the Arabic name, and ONLY if one was entered
 *     otherwise  ->  the English name
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not TRANSLATE anything. A project called "Riyadh Commercial
 * Tower" with no `nameAr` stays exactly that in Arabic. Machine-
 * translating a contract name would invent an identity the contract does
 * not have, and two people would then be discussing "the tower project"
 * and mean different records. A name is a proper noun and an identifier;
 * it changes only when a human types the other one.
 *
 * The same reasoning applies to change-order descriptions, claim types
 * and budget category names: they are user-entered content, not UI
 * strings, and PACTUM shows them as they were written.
 *
 * Blank-safe: a `nameAr` of '' or whitespace counts as absent, because a
 * blank heading is worse than an English one.
 * ══════════════════════════════════════════════════════════════════════
 */

export type Lang = 'en' | 'ar';

/** Anything carrying a bilingual name. All fields optional by design. */
export interface Nameable {
  nameEn?: unknown;
  nameAr?: unknown;
  /** Master-data entities use `name` for the English form. */
  name?: unknown;
  id?: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
}

/**
 * The name to show for any entity.
 *
 * Falls back down a chain that never returns an empty string while any
 * identifier exists: Arabic → English → `name` → id → ''.
 */
export function displayName(entity: Nameable | null | undefined, lang: Lang): string {
  if (!entity) return '';
  const ar = str(entity.nameAr);
  const en = str(entity.nameEn) || str(entity.name);
  if (lang === 'ar' && ar) return ar;
  return en || ar || str(entity.id);
}

/** Convenience for the common `isRtl` boolean already in scope. */
export function displayNameRtl(entity: Nameable | null | undefined, isRtl: boolean): string {
  return displayName(entity, isRtl ? 'ar' : 'en');
}

/**
 * A project's city, resolved the same way.
 *
 * Cities ARE translated in the data — every project carries `cityEn` and
 * `cityAr` — so unlike a contract name there is a real Arabic form to
 * show.
 */
export function displayCity(
  p: { cityEn?: unknown; cityAr?: unknown } | null | undefined, lang: Lang,
): string {
  if (!p) return '';
  const ar = str(p.cityAr);
  const en = str(p.cityEn);
  if (lang === 'ar' && ar) return ar;
  return en || ar;
}

/**
 * True when an entity has no Arabic name to show.
 *
 * Lets a screen say so honestly — "no Arabic name entered" — instead of
 * silently presenting the English one as though it were the translation.
 */
export function missingArabicName(entity: Nameable | null | undefined): boolean {
  if (!entity) return false;
  return str(entity.nameAr) === '' && (str(entity.nameEn) !== '' || str(entity.name) !== '');
}
