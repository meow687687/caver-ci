import picomatch from 'picomatch';

/** Only the documented subset supported by caver-ci is accepted. */
export function validPatterns(patterns: string[], allowNegative: boolean): boolean {
  let hasPositive = false;
  for (const raw of patterns) {
    const negative = raw.startsWith('!');
    const pattern = negative ? raw.slice(1) : raw;
    if (
      (negative && !allowNegative) ||
      !pattern ||
      /[\[\]{}()|+?\\!]/.test(pattern) ||
      pattern.split('/').some(segment => segment.includes('**') && segment !== '**') ||
      pattern.startsWith('/') ||
      pattern.includes('//') ||
      /(^|\/)\.\.?($|\/)/.test(pattern)
    ) return false;
    if (!negative) hasPositive = true;
  }
  return hasPositive;
}

/** Evaluate ordered include/exclude patterns, where the last matching pattern wins. */
export function matchesPatterns(value: string, patterns: string[]): boolean {
  let included = false;
  for (const raw of patterns) {
    const negative = raw.startsWith('!');
    const pattern = negative ? raw.slice(1) : raw;
    if (picomatch.isMatch(value, pattern, { dot: true, noext: true, nonegate: true })) {
      included = !negative;
    }
  }
  return included;
}
