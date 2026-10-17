// Translation for the reader of a message. Main engine: Google Translate's free
// web endpoint (the same kind of service NVDA's Instant Translate uses), which
// works in any browser. Fallback: the browser's built-in translator (Chrome
// 138+ desktop), but only for language pairs already on the computer.

const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t';
const TIMEOUT_MS = 10000;

const translators = new Map(); // "from|to" -> Promise<Translator>
const cache = new Map();       // "from|to|text" -> translated text

// Google's codes differ from ours for Chinese.
const GOOGLE_CODES = { 'zh': 'zh-CN', 'zh-Hant': 'zh-TW' };
const googleCode = code => GOOGLE_CODES[code] ?? code;

class TranslationError extends Error {
  constructor(reason, detail) {
    super(detail);
    this.reason = reason;
  }
}

async function google(text, from, to) {
  const url = `${GOOGLE_URL}&sl=${encodeURIComponent(googleCode(from))}&tl=${encodeURIComponent(googleCode(to))}`;
  let response;
  try {
    // POST so long messages don't make the address too long.
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new TranslationError('timeout', 'no reply within 10 seconds');
    throw new TranslationError(navigator.onLine ? 'network' : 'offline', e.message);
  }
  if (response.status === 429) throw new TranslationError('busy', 'too many requests (429)');
  if (!response.ok) throw new TranslationError('failed', `Google replied ${response.status} ${response.statusText}`.trim());
  try {
    const data = await response.json();
    // data[0] is a list of [translated, original, ...] segments.
    const result = data[0].map(segment => segment[0] ?? '').join('');
    if (!result) throw new Error('empty reply');
    return result;
  } catch (e) {
    throw new TranslationError('failed', `unexpected reply from Google: ${e.message}`);
  }
}

// The built-in translator, only if this pair needs no download (a download
// would need a key press or click, which a fallback can't wait for).
async function builtIn(text, from, to) {
  if (!('Translator' in self)) return null;
  const key = `${from}|${to}`;
  if (!translators.has(key)) {
    let status;
    try {
      status = await Translator.availability({ sourceLanguage: from, targetLanguage: to });
    } catch {
      return null;
    }
    if (status !== 'available') return null;
    const promise = Translator.create({ sourceLanguage: from, targetLanguage: to });
    translators.set(key, promise);
    promise.catch(() => translators.delete(key));
  }
  try {
    const translator = await translators.get(key);
    return await translator.translate(text);
  } catch (e) {
    console.warn('Built-in translation failed', e);
    return null;
  }
}

// Resolves to { text, lang, translated, error, detail }. Never rejects: on
// failure the original text comes back with its own language, an error reason
// ('offline' | 'network' | 'timeout' | 'busy' | 'failed') and the detail.
export async function translate(text, from, to) {
  if (from === to) return { text, lang: to, translated: false, error: null, detail: '' };

  const cacheKey = `${from}|${to}|${text}`;
  if (cache.has(cacheKey)) return { text: cache.get(cacheKey), lang: to, translated: true, error: null, detail: '' };

  let failure;
  try {
    const result = await google(text, from, to);
    cache.set(cacheKey, result);
    return { text: result, lang: to, translated: true, error: null, detail: '' };
  } catch (e) {
    console.warn('Google translation failed', e);
    failure = e instanceof TranslationError ? e : new TranslationError('failed', e.message);
  }

  const fallback = await builtIn(text, from, to);
  if (fallback) {
    cache.set(cacheKey, fallback);
    return { text: fallback, lang: to, translated: true, error: null, detail: '' };
  }
  return { text, lang: from, translated: false, error: failure.reason, detail: failure.message };
}
