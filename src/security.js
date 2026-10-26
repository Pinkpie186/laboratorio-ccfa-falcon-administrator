import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const hashPassword = value => bcrypt.hash(value, config.bcryptRounds);
export const verifyPassword = (value, hash) => bcrypt.compare(value, hash);
export const safeText = (value, max = 500) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
export const redact = value => safeText(value, 4000)
  .replace(/\b([a-f0-9]{32})\b/gi, '[REDACTED_ID]')
  .replace(/\b(?:client[_ -]?secret|token|cid|authorization)\s*[:=]\s*\S+/gi, '[REDACTED_SECRET]')
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]');
export const cookieOptions = () => ({
  httpOnly: true, sameSite: 'strict', secure: config.env === 'production',
  path: '/', maxAge: config.sessionTtlHours * 3600_000
});
export function seededShuffle(items, seed) {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) || 1;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const output = [...items];
  for (let i = output.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [output[i], output[j]] = [output[j], output[i]]; }
  return output;
}

