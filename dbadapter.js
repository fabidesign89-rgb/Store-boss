'use strict';
// Couche base de données ASYNCHRONE avec deux moteurs :
//  - sqlite : SQLite local (node:sqlite) — développement, Docker, VPS
//  - turso  : Turso/libSQL via HTTP (fetch, sans dépendance) — Vercel et autres hébergeurs serverless
// Interface : get(sql,args) / all(sql,args) / run(sql,args) / exec(sql) / tx(async (ex) => ...)

function sqliteAdapter(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  let txActive = false; let waiters = [];
  const idle = async () => { while (txActive) await new Promise((r) => waiters.push(r)); };
  const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const core = {
    async get(sql, a = []) { return db.prepare(sql).get(...norm(a)); },
    async all(sql, a = []) { return db.prepare(sql).all(...norm(a)); },
    async run(sql, a = []) { const r = db.prepare(sql).run(...norm(a)); return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
  };
  const wrap = (f) => async (...x) => { await idle(); return f(...x); };
  const ad = {
    kind: 'sqlite', get: wrap(core.get), all: wrap(core.all), run: wrap(core.run),
    async exec(sql) { await idle(); db.exec(sql); },
    async tx(fn) {
      await idle(); txActive = true; db.exec('BEGIN');
      try { const r = await fn(core); db.exec('COMMIT'); return r; }
      catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
      finally { txActive = false; const w = waiters; waiters = []; w.forEach((f) => f()); }
    },
    close() { try { db.close(); } catch {} },
  };
  return ad;
}

function tursoAdapter(url, token, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const base = String(url).replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
  const arg = (v) => {
    if (v === null || v === undefined) return { type: 'null' };
    if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
    if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
    if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
    return { type: 'text', value: String(v) };
  };
  const val = (c) => {
    switch (c.type) {
      case 'null': return null;
      case 'integer': return Number(c.value);
      case 'float': return Number(c.value);
      case 'blob': return Buffer.from(c.base64 || '', 'base64');
      default: return c.value;
    }
  };
  async function pipeline(baton, baseUrl, requests) {
    let res;
    try {
      res = await doFetch((baseUrl || base) + '/v2/pipeline', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ baton: baton || null, requests }),
      });
    } catch (e) { throw new Error('Base de données injoignable : ' + e.message); }
    if (!res.ok) throw new Error(`Base de données : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const r of data.results || []) if (r.type === 'error') throw new Error('SQL : ' + (r.error && r.error.message));
    return data;
  }
  const decode = (result) => {
    const cols = result.cols.map((c) => c.name);
    return result.rows.map((row) => Object.fromEntries(row.map((c, i) => [cols[i], val(c)])));
  };
  const execReq = (sql, a = []) => ({ type: 'execute', stmt: { sql, args: a.map(arg) } });
  // Exécuteur lié à un flux (baton) pour les transactions, ou sans état pour les requêtes isolées
  function executor(state) {
    const exec1 = async (sql, a) => {
      if (!state) { const d = await pipeline(null, null, [execReq(sql, a), { type: 'close' }]); return d.results[0].response.result; }
      const d = await pipeline(state.baton, state.baseUrl, [execReq(sql, a)]);
      state.baton = d.baton || state.baton; state.baseUrl = d.base_url || state.baseUrl;
      return d.results[0].response.result;
    };
    return {
      async get(sql, a) { return decode(await exec1(sql, a))[0]; },
      async all(sql, a) { return decode(await exec1(sql, a)); },
      async run(sql, a) { const r = await exec1(sql, a); return { lastInsertRowid: r.last_insert_rowid == null ? 0 : Number(r.last_insert_rowid), changes: Number(r.affected_row_count || 0) }; },
    };
  }
  const plain = executor(null);
  return {
    kind: 'turso', ...plain,
    async exec(sql) {
      const stmts = sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
      await pipeline(null, null, [...stmts.map((s) => execReq(s)), { type: 'close' }]);
    },
    async tx(fn) {
      const state = { baton: null, baseUrl: null };
      const d = await pipeline(null, null, [execReq('BEGIN')]);
      state.baton = d.baton; state.baseUrl = d.base_url;
      if (!state.baton) throw new Error('Transaction impossible (pas de baton).');
      const ex = executor(state);
      try {
        const r = await fn(ex);
        await pipeline(state.baton, state.baseUrl, [execReq('COMMIT'), { type: 'close' }]);
        return r;
      } catch (e) {
        try { await pipeline(state.baton, state.baseUrl, [execReq('ROLLBACK'), { type: 'close' }]); } catch {}
        throw e;
      }
    },
    close() {},
  };
}
module.exports = { sqliteAdapter, tursoAdapter };
