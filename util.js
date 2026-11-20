'use strict';
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
};
const verifyPassword = (pw, stored) => {
  try {
    const [alg, s, h] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const test = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
  } catch { return false; }
};
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'element';
const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Limiteur simple en mémoire (par clé)
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}
module.exports = { HttpError, hashPassword, verifyPassword, sha256, slugify, clean, EMAIL_RE, makeLimiter };
