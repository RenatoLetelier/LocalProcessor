// Media containers tag languages with ISO 639-2 codes (spa, eng, fre/fra...) while
// HLS/DASH manifests use BCP-47 tags in their shortest form (es, en, fr...).
// Both the bibliographic (B) and terminologic (T) three-letter variants are mapped.
const ISO_639_2_TO_1: Record<string, string> = {
  ara: 'ar', bul: 'bg', cat: 'ca', ces: 'cs', cze: 'cs', dan: 'da', deu: 'de', ger: 'de', ell: 'el', gre: 'el',
  eng: 'en', spa: 'es', est: 'et', eus: 'eu', baq: 'eu', fas: 'fa', per: 'fa', fin: 'fi', fra: 'fr', fre: 'fr',
  glg: 'gl', heb: 'he', hin: 'hi', hrv: 'hr', hun: 'hu', ind: 'id', isl: 'is', ice: 'is', ita: 'it', jpn: 'ja',
  kor: 'ko', lit: 'lt', lav: 'lv', mkd: 'mk', mac: 'mk', msa: 'ms', may: 'ms', nld: 'nl', dut: 'nl', nor: 'no',
  nob: 'nb', nno: 'nn', pol: 'pl', por: 'pt', ron: 'ro', rum: 'ro', rus: 'ru', slk: 'sk', slo: 'sk', slv: 'sl',
  srp: 'sr', swe: 'sv', tam: 'ta', tel: 'te', tha: 'th', tur: 'tr', ukr: 'uk', urd: 'ur', vie: 'vi', zho: 'zh',
  chi: 'zh', ben: 'bn', mal: 'ml', kan: 'kn', mar: 'mr', guj: 'gu', pan: 'pa', fil: 'fil', tgl: 'tl', lat: 'la',
  afr: 'af', sqi: 'sq', alb: 'sq', hye: 'hy', arm: 'hy', kat: 'ka', geo: 'ka', kaz: 'kk', bel: 'be', bos: 'bs',
  gle: 'ga', cym: 'cy', wel: 'cy', mlt: 'mt', swa: 'sw', amh: 'am', mya: 'my', bur: 'my', khm: 'km', lao: 'lo',
  mon: 'mn', nep: 'ne', sin: 'si', aze: 'az', uzb: 'uz'
}

export const UNDETERMINED = 'und'

// Returns a BCP-47 tag: 2-letter when one exists, otherwise the 3-letter code itself
export function toBcp47(tag: string | null | undefined): string {
  if (!tag) return UNDETERMINED
  const lower = tag.trim().toLowerCase()
  if (!lower || lower === UNDETERMINED) return UNDETERMINED
  const [base, ...rest] = lower.split(/[-_]/)
  const mapped = base && base.length === 3 ? (ISO_639_2_TO_1[base] ?? base) : base
  return [mapped, ...rest].filter(Boolean).join('-')
}

// Human-readable name in the language itself ("Español", "English"); falls back to the tag
export function languageDisplayName(bcp47: string): string {
  if (bcp47 === UNDETERMINED) return 'Desconocido'
  try {
    const name = new Intl.DisplayNames([bcp47], { type: 'language' }).of(bcp47)
    if (!name || name === bcp47) return bcp47
    return name.charAt(0).toUpperCase() + name.slice(1)
  } catch {
    return bcp47
  }
}
