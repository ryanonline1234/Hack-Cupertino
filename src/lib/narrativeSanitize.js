/*
 * Narrative sanitizer: some free-tier models restate the prompt's formatting
 * instructions (or think aloud about them) instead of just answering, so the
 * "Community Narrative" card ends up displaying our own instructions back at
 * the user ("We need exactly two short paragraphs, no headers…"). Prompt
 * hardening alone doesn't hold on weak models, so we strip instruction-echo
 * sentences as a deterministic post-processing guard, before the existing
 * two-paragraph normalization in AICard.
 *
 * Only sentences that match meta-instruction patterns are dropped; data
 * sentences pass through untouched, paragraph breaks preserved. If every
 * sentence is echo (degenerate reply), the longest original sentence is
 * kept so the card never goes blank from this function alone.
 */

const ECHO_PATTERNS = [
  /\btwo (short )?paragraphs?\b/i,
  /\bno headers?\b/i,
  /\bbullet points?\b/i,
  /\bmust not\b/i,
  /\bmust be\b/i,
  /\bno hype\b/i,
  /\bno hedging\b/i,
  /\bavoid jargon\b/i,
  /\bplain english\b/i,
  /\bno disclaimers?\b/i,
  /\bextra text\b/i,
  /\bblank line\b/i,
  /^we need\b/i,
  /\bshort paragraphs?\b/i,
];

const DEC_DOT = '\u0000';

function isEcho(sentence) {
  return ECHO_PATTERNS.some((re) => re.test(sentence));
}

function cleanBlock(block) {
  // Protect decimal points ("0.0%") from the sentence splitter, then
  // restore them after filtering.
  const shielded = block.replace(/(\d)\.(\d)/g, `$1${DEC_DOT}$2`);
  const sentences = shielded.match(/[^.!?]+[.!?]+["']?|\S[^.!?]*$/g) || [shielded];
  const kept = sentences
    .map((s) => s.trim().replaceAll(DEC_DOT, '.'))
    .filter((s) => s.length > 0 && !isEcho(s));
  return kept.join(' ');
}

export function stripInstructionEcho(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return '';
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map(cleanBlock)
    .filter(Boolean);
  if (blocks.length > 0) return blocks.join('\n\n');
  // Degenerate: the whole reply was echo. Keep the longest raw sentence
  // rather than blanking the card — it usually carries the most content.
  const fallback = (text.match(/[^.!?]+[.!?]+["']?|\S[^.!?]*$/g) || [text])
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];
  return fallback || '';
}
