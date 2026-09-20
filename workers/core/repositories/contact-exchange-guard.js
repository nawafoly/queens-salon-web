// MALIKAT Connect — server-side contact exchange guard.
// The client UI may mirror these checks for UX, but Core is authoritative.

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const SOCIAL_KEYWORDS = /(?:انستا(?:غرام)?|instagram|سناب(?:شات)?|snapchat|واتس(?:اب)?|whatsapp|تلغرام|تيليجرام|telegram|tiktok|تيك\s*توك|twitter|تويتر|\bx\b)/iu;
const CONTACT_LANGUAGE = /(?:كلم(?:يني|ني)|تواصل(?:ي)?\s*(?:معي|معايا|برا|خارج)|ضيف(?:يني|ني)|هذا\s+(?:حسابي|سنابي|انستاي|واتسي|رقمي)|أرسل(?:ي)?\s+(?:رقم|حساب)|خاص\s*(?:برا|خارج)?)/iu;

function toAsciiDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));
}

export function normalizeConnectText(value) {
  return toAsciiDigits(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .trim();
}

function digitsOnly(value) {
  return normalizeConnectText(value).replace(/\D/g, '');
}

function looksLikeKsaPhone(digits) {
  const value = String(digits || '');
  return /^05\d{8}$/.test(value) ||
    /^5\d{8}$/.test(value) ||
    /^9665\d{8}$/.test(value) ||
    /^009665\d{8}$/.test(value);
}

function numericFragment(value) {
  const normalized = normalizeConnectText(value)
    .replace(/[\s._,;:!?()[\]{}+\-—–/\\|~"'،؛]+/g, '');
  if (!normalized || /[^0-9]/.test(normalized)) return '';
  return normalized.length <= 4 ? normalized : '';
}

function decodeNumberWords(value) {
  const replacements = new Map([
    ['صفر', '0'], ['zero', '0'],
    ['واحد', '1'], ['one', '1'],
    ['اثنين', '2'], ['اثنان', '2'], ['two', '2'],
    ['ثلاثة', '3'], ['three', '3'],
    ['اربعة', '4'], ['أربعة', '4'], ['four', '4'],
    ['خمسة', '5'], ['five', '5'],
    ['ستة', '6'], ['six', '6'],
    ['سبعة', '7'], ['seven', '7'],
    ['ثمانية', '8'], ['eight', '8'],
    ['تسعة', '9'], ['nine', '9'],
  ]);
  const tokens = normalizeConnectText(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let sequence = '';
  for (const token of tokens) {
    if (/^\d$/.test(token)) {
      sequence += token;
      continue;
    }
    if (replacements.has(token)) {
      sequence += replacements.get(token);
      continue;
    }
    if (sequence.length < 9) sequence = '';
  }
  return sequence;
}

function detectEmail(normalized) {
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(normalized)) return true;
  const obfuscated = normalized
    .replace(/\s+(?:at|آت|ات)\s+/giu, '@')
    .replace(/\s+(?:dot|دوت|نقطة)\s+/giu, '.');
  return /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(obfuscated);
}

function detectExternalLink(normalized, allowedDomains = []) {
  const matches = normalized.match(/(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/giu) || [];
  if (!matches.length) return false;
  const allowed = new Set(allowedDomains.map((domain) => String(domain || '').toLowerCase().replace(/^www\./, '')));
  return matches.some((candidate) => {
    const host = candidate
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[/?#]/)[0]
      .toLowerCase();
    if (!host) return false;
    return ![...allowed].some((domain) => host === domain || host.endsWith(`.${domain}`));
  });
}

function detectSocialHandle(normalized, recentNormalized) {
  if (SOCIAL_KEYWORDS.test(normalized) && /@[a-z0-9._-]{2,}/i.test(normalized)) return true;
  if (/(?:instagram\.com|snapchat\.com|tiktok\.com|t\.me|telegram\.me|wa\.me)\//i.test(normalized)) return true;

  const recentHasPlatformContext = recentNormalized.slice(-4).some((value) => SOCIAL_KEYWORDS.test(value));
  const currentLooksLikeHandle = /^@?[a-z][a-z0-9._-]{2,30}$/i.test(normalized.replace(/\s+/g, ''));
  return recentHasPlatformContext && currentLooksLikeHandle;
}

export function inspectContactExchange({
  body,
  recentBodies = [],
  allowedDomains = ['malikat.com', 'queens-salon-web.vercel.app'],
} = {}) {
  const normalized = normalizeConnectText(body);
  const recentNormalized = recentBodies.map(normalizeConnectText).filter(Boolean);

  if (!normalized) {
    return { blocked: false, detectionType: null, severity: null };
  }

  const fragment = numericFragment(normalized);
  if (fragment) {
    return {
      blocked: true,
      detectionType: 'numeric_fragment',
      severity: 'high',
    };
  }

  const currentDigits = digitsOnly(normalized);
  if (looksLikeKsaPhone(currentDigits)) {
    return {
      blocked: true,
      detectionType: 'phone_number',
      severity: 'high',
    };
  }

  const splitFragments = [...recentBodies.slice(-12), body]
    .map(numericFragment)
    .filter(Boolean);
  if (splitFragments.length >= 3) {
    const combined = splitFragments.join('');
    for (let start = 0; start < combined.length; start += 1) {
      for (const size of [9, 10, 12, 14]) {
        const candidate = combined.slice(start, start + size);
        if (looksLikeKsaPhone(candidate)) {
          return {
            blocked: true,
            detectionType: 'split_phone_number',
            severity: 'critical',
          };
        }
      }
    }
  }

  const numberWordSequence = decodeNumberWords([...recentNormalized.slice(-6), normalized].join(' '));
  if (numberWordSequence.length >= 9) {
    for (let start = 0; start < numberWordSequence.length; start += 1) {
      for (const size of [9, 10, 12, 14]) {
        const candidate = numberWordSequence.slice(start, start + size);
        if (looksLikeKsaPhone(candidate)) {
          return {
            blocked: true,
            detectionType: 'split_phone_number',
            severity: 'critical',
          };
        }
      }
    }
  }

  if (detectEmail(normalized)) {
    return {
      blocked: true,
      detectionType: 'email',
      severity: 'high',
    };
  }

  if (detectSocialHandle(normalized, recentNormalized)) {
    return {
      blocked: true,
      detectionType: 'social_handle',
      severity: 'high',
    };
  }

  if (detectExternalLink(normalized, allowedDomains)) {
    return {
      blocked: true,
      detectionType: 'external_link',
      severity: 'high',
    };
  }

  if (CONTACT_LANGUAGE.test(normalized) && SOCIAL_KEYWORDS.test([...recentNormalized.slice(-3), normalized].join(' '))) {
    return {
      blocked: true,
      detectionType: 'contact_exchange_language',
      severity: 'medium',
    };
  }

  return { blocked: false, detectionType: null, severity: null };
}
