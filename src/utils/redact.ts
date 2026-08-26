/**
 * Secret redaction + debug-logging hygiene for the LACRM MCP server.
 *
 * Two concerns live here:
 *  1. `redactSecrets` — mask structurally-recognizable credentials (Asana PATs,
 *     Lob/Stripe keys, bearer tokens, KEY/TOKEN/SECRET assignments) out of any
 *     string that might be logged.
 *  2. `debugParams` / `debugFileMeta` — the safe shape for the `[DEBUG] API call`
 *     lines. LACRM tool parameters routinely carry PII (contact names,
 *     addresses, private notes). Even at debug verbosity we do NOT dump raw
 *     parameter VALUES by default — only the parameter KEYS. Full values require
 *     an explicit, purpose-specific opt-in (`LACRM_DEBUG_PARAMS`), and even then
 *     token-shaped values are masked.
 *
 * The API key itself is sent in the Authorization header, never in the params,
 * so it is not at risk here — but a token could still appear in a param value
 * (e.g. a note pasted by a user), which the masking below catches.
 */

interface Rule {
  pattern: RegExp;
  replace: string | ((...args: string[]) => string);
}

// This rule block is intentionally self-contained (no shared dependency) so the
// module can be copied between projects unchanged. If you keep sibling copies
// elsewhere, mirror any change to all of them.
const RULES: Rule[] = [
  // PEM private-key blocks (multi-line) — mask the whole block.
  { pattern: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, replace: '[REDACTED_PRIVATE_KEY]' },
  // Credential-bearing URL query/fragment - the whole query is dropped, scheme,
  // host and path survive. A signed asset URL (`?...&signature=<sig>`) is a
  // bearer credential in URL clothing, and some upstreams carry a PERMANENT
  // secret the same way (`?api_key=<key>`). Must stay SECOND (after PEM) so no
  // later rule half-masks a value inside a query first. Not anchored on a
  // scheme: a client reports a connection failure as a bare path with the
  // credential intact. Full reasoning lives beside the copy in the allegiance
  // repo's session-archival-daemon/src/redact.ts.
  { pattern: /([?#])(?:[^\s"'<>`)#&]*&)*?[A-Za-z0-9_.%-]*(?:signature|sig|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|credential|password)=[^\s"'<>`)#&\[\]]{8,}[^\s"'<>`)#]*/gi, replace: '$1[REDACTED_QUERY]' },
  // Asana PATs: `1/<gid>:<hex>` and `2/<gid>/<gid>:<hex>`. The `:` + long hex is
  // the low-false-positive anchor (a bare fraction/date never matches).
  { pattern: /\b[0-2]\/\d{6,}(?:\/\d{6,})?:[0-9a-f]{24,}\b/gi, replace: '[REDACTED_ASANA_TOKEN]' },
  // Provider-prefixed keys/tokens — distinctive prefixes, caught even unlabeled.
  { pattern: /\bsk-ant-[0-9A-Za-z_-]{20,}/g, replace: '[REDACTED_KEY]' },       // Anthropic
  { pattern: /\bsk-[0-9A-Za-z]{20,}\b/g, replace: '[REDACTED_KEY]' },           // OpenAI-style
  { pattern: /\bgh[opsur]_[0-9A-Za-z]{36,}\b/g, replace: '[REDACTED_KEY]' },    // GitHub
  { pattern: /\bxox[a-z]-[0-9A-Za-z-]{10,}/g, replace: '[REDACTED_KEY]' },      // Slack
  { pattern: /\bya29\.[0-9A-Za-z_-]{20,}/g, replace: '[REDACTED_TOKEN]' },      // Google OAuth
  { pattern: /\bAIza[0-9A-Za-z_-]{35,}\b/g, replace: '[REDACTED_KEY]' },        // Google API key
  // Stripe-style prefixed keys.
  { pattern: /\b[sprSPR]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g, replace: '[REDACTED_KEY]' },
  // Lob-style live_/test_ keys (>=24 run keeps `test_mode` etc. safe).
  { pattern: /\b(?:live|test)_[0-9A-Za-z]{24,}\b/g, replace: '[REDACTED_KEY]' },
  // Authorization: Bearer <token> (case-insensitive scheme).
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, replace: 'Bearer [REDACTED_TOKEN]' },
  // A long value assigned to a secret-ish key name — keep the key, mask the value.
  {
    pattern: /\b([A-Za-z0-9_.-]*(?:authorization|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|bearer[_-]?token|token|secret|client[_-]?secret|private[_-]?key|password|passwd|pwd))(["']?\s*[:=]\s*["']?)([A-Za-z0-9._\-+/]{12,}={0,2})/gi,
    replace: (_m: string, key: string, delim: string) => `${key}${delim}[REDACTED]`,
  },
];

/** Mask known secret patterns in a string. Idempotent; '' -> ''. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const rule of RULES) out = out.replace(rule.pattern, rule.replace as any);
  return out;
}

/** Recursively redact secret-shaped strings inside an arbitrary value. */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}

/** True only when the operator has explicitly opted into logging param VALUES. */
function paramValuesEnabled(): boolean {
  const v = process.env.LACRM_DEBUG_PARAMS;
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * The safe data object for a `[DEBUG] API call` log line.
 * Default: the parameter KEYS only (shape without PII). With LACRM_DEBUG_PARAMS
 * set, the full values (secrets masked) for deep debugging.
 */
export function debugParams(params: Record<string, unknown>): Record<string, unknown> {
  if (paramValuesEnabled()) return { parameters: redactDeep(params) };
  return { paramKeys: Object.keys(params ?? {}) };
}

/**
 * The safe data object for a `[DEBUG] API call with file` log line. A filename
 * can itself be PII, so it is omitted unless LACRM_DEBUG_PARAMS is set.
 */
export function debugFileMeta(file: { name: string; content: { length: number }; mimeType: string }): Record<string, unknown> {
  const base: Record<string, unknown> = { bytes: file.content.length, mimeType: file.mimeType };
  if (paramValuesEnabled()) base.fileName = redactSecrets(file.name);
  return base;
}
