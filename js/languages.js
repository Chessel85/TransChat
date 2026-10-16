// Languages offered in the picker: those Chrome's built-in translator handles.
// Whether a particular pair works is still checked at runtime.
export const LANGUAGE_CODES = [
  'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he',
  'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'mr', 'nl', 'no',
  'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te', 'th', 'tr', 'uk',
  'vi', 'zh', 'zh-Hant',
];

const english = new Intl.DisplayNames(['en'], { type: 'language' });

// Name of a language in English, for interface text ("María speaks Spanish").
export function languageName(code) {
  return english.of(code) ?? code;
}

// Name of a language in that language itself ("Español"), capitalised.
export function nativeName(code) {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return languageName(code);
  }
}

// Best match for the user's browser/OS languages, falling back to English.
export function defaultLanguage(preferred = navigator.languages ?? [navigator.language]) {
  for (const tag of preferred) {
    if (!tag) continue;
    const lower = tag.toLowerCase();
    if (/^zh-(tw|hk|mo|hant)/.test(lower)) return 'zh-Hant';
    const exact = LANGUAGE_CODES.find(c => c.toLowerCase() === lower);
    if (exact) return exact;
    let base = lower.split('-')[0];
    if (base === 'iw') base = 'he';
    if (base === 'nb' || base === 'nn') base = 'no';
    if (LANGUAGE_CODES.includes(base)) return base;
  }
  return 'en';
}
