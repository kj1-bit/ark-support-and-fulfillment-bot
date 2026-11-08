'use strict';

const SENSITIVE_KEY = /(token|secret|password|passphrase|pin|eos.?id|authorization|cookie|response)/i;
const EOS_ID = /\b[0-9a-f]{32}\b/gi;
const TOKEN_LIKE = /\b(?:mfa\.[\w-]{20,}|[\w-]{24,}\.[\w-]{6,}\.[\w-]{20,}|gh[opusr]_[A-Za-z0-9_]{20,})\b/g;

function maskIdentifier(value) {
  const text = String(value ?? '');
  if (text.length < 12) return '[REDACTED]';
  return `${text.slice(0, 6)}...${text.slice(-6)}`;
}

function redactString(value) {
  return String(value)
    .replace(EOS_ID, match => maskIdentifier(match))
    .replace(TOKEN_LIKE, '[REDACTED]');
}

function redact(value, seen = new WeakMap()) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.set(value, true);
  if (Array.isArray(value)) return Object.freeze(value.map(item => redact(item, seen)));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, seen);
  }
  return Object.freeze(output);
}

module.exports = { maskIdentifier, redact, redactString, SENSITIVE_KEY };
