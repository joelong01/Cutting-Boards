/**
 * Parse shop-style lengths: `1 1/2`, `1-1/2"`, `3/4`, `1.5`. Returns null when not a length. An
 * inch mark after the number is ignored, whichever one the keyboard gives: a straight quote, the
 * curly quotes a phone puts in its place, a double prime, two single primes, or "in".
 */
export function parseLength(text: string): number | null {
  const t = text.trim().replace(/["″“”„‟]|′′|''|in\.?$/g, '').trim();
  if (!t) return null;
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1).trim() : t;
  let m = /^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/.exec(body);
  let v: number;
  if (m) {
    if (+m[3] === 0) return null;
    v = +m[1] + +m[2] / +m[3];
  } else if ((m = /^(\d+)\s*\/\s*(\d+)$/.exec(body))) {
    if (+m[2] === 0) return null;
    v = +m[1] / +m[2];
  } else if (/^(\d+\.?\d*|\.\d+)$/.test(body)) {
    v = parseFloat(body);
  } else {
    return null;
  }
  return neg ? -v : v;
}

/** Format to the nearest 1/64 when that is exact enough, otherwise three decimals. */
export function formatLength(v: number): string {
  if (!isFinite(v)) return '?';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  const n64 = Math.round(a * 64);
  if (Math.abs(a - n64 / 64) > 0.0008) return sign + a.toFixed(3).replace(/\.?0+$/, '');
  const whole = Math.floor(n64 / 64);
  let num = n64 % 64, den = 64;
  while (num && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  if (!num) return sign + String(whole);
  return sign + (whole ? `${whole} ` : '') + `${num}/${den}`;
}

/** A length formatted for display with the inch mark. */
export const inches = (v: number): string => `${formatLength(v)}″`;
