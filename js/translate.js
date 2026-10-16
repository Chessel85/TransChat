// Translation via the browser's built-in, on-device Translator API
// (Chrome 138+ desktop). Each receiver translates incoming text into
// their own language.

const translators = new Map(); // "from|to" -> Promise<Translator>
const cache = new Map();       // "from|to|text" -> translated text

export function builtInSupported() {
  return 'Translator' in self;
}

// 'same' | 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'
export async function pairStatus(from, to) {
  if (from === to) return 'same';
  if (!builtInSupported()) return 'unsupported';
  try {
    return await Translator.availability({ sourceLanguage: from, targetLanguage: to });
  } catch {
    return 'unavailable';
  }
}

// Creates (and downloads if needed) a translator for a pair. A download
// requires a recent user action such as a key press, otherwise this rejects
// with NotAllowedError.
export function prepare(from, to, onProgress) {
  const key = `${from}|${to}`;
  if (translators.has(key)) return translators.get(key);
  const promise = Translator.create({
    sourceLanguage: from,
    targetLanguage: to,
    monitor(m) {
      m.addEventListener('downloadprogress', e => onProgress?.(e.loaded));
    },
  });
  translators.set(key, promise);
  promise.catch(() => translators.delete(key));
  return promise;
}

// Resolves to { text, lang, translated, error }. Never rejects: on failure the
// original text comes back with its own language and an error reason.
export async function translate(text, from, to) {
  if (from === to) return { text, lang: to, translated: false, error: null };
  if (!builtInSupported()) return { text, lang: from, translated: false, error: 'unsupported' };

  const cacheKey = `${from}|${to}|${text}`;
  if (cache.has(cacheKey)) return { text: cache.get(cacheKey), lang: to, translated: true, error: null };

  try {
    const translator = await prepare(from, to);
    const result = await translator.translate(text);
    cache.set(cacheKey, result);
    return { text: result, lang: to, translated: true, error: null };
  } catch (e) {
    const error = e?.name === 'NotAllowedError' ? 'needs-download' : 'failed';
    return { text, lang: from, translated: false, error };
  }
}
