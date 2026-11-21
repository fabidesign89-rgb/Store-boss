'use strict';
// Faux serveur « Hrana over HTTP » (POST /v2/pipeline) adossé à node:sqlite.
// Sert à vérifier le protocole client (types, baton, transactions, blobs) SANS compte Turso.
// Ce n'est PAS un test contre le vrai service Turso.
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

function start() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON');
  const batons = new Set(); let n = 0; const log = [];
  const toArg = (a) => {
    switch (a.type) {
      case 'null': return null;
      case 'integer': { if (typeof a.value !== 'string') throw new Error('integer doit être une chaîne'); return Number(a.value); }
      case 'float': return Number(a.value);
      case 'blob': return Buffer.from(a.base64, 'base64');
      case 'text': return a.value;
      default: throw new Error('type inconnu ' + a.type);
    }
  };
  const toVal = (v) => v === null || v === undefined ? { type: 'null' }
    : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v })
    : typeof v === 'bigint' ? { type: 'integer', value: String(v) }
    : v instanceof Uint8Array ? { type: 'blob', base64: Buffer.from(v).toString('base64') } : { type: 'text', value: String(v) };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url !== '/v2/pipeline' || req.method !== 'POST') return send(404, { error: 'not found' });
      if (req.headers.authorization !== 'Bearer test-token') return send(401, { error: 'unauthorized' });
      const msg = JSON.parse(body);
      if (msg.baton && !batons.has(msg.baton)) return send(400, { error: 'baton invalide' });
      let baton = msg.baton || null; const results = [];
      for (const r of msg.requests) {
        if (r.type === 'close') { if (baton) batons.delete(baton); baton = null; results.push({ type: 'ok', response: { type: 'close' } }); continue; }
        try {
          log.push(r.stmt.sql.slice(0, 40));
          const st = db.prepare(r.stmt.sql); const args = (r.stmt.args || []).map(toArg);
          const isRead = /^\s*(select|pragma|with)/i.test(r.stmt.sql);
          let result;
          if (isRead) {
            const cols = st.columns().map((c) => ({ name: c.name, decltype: c.type })); const rows = st.all(...args);
            result = { cols, rows: rows.map((row) => cols.map((c) => toVal(row[c.name]))), affected_row_count: 0, last_insert_rowid: null };
          } else {
            const info = st.run(...args);
            result = { cols: [], rows: [], affected_row_count: Number(info.changes), last_insert_rowid: info.changes ? String(info.lastInsertRowid) : null };
          }
          if (!baton && /^\s*begin/i.test(r.stmt.sql)) { baton = 'b' + ++n; batons.add(baton); }
          results.push({ type: 'ok', response: { type: 'execute', result } });
        } catch (e) { results.push({ type: 'error', error: { message: e.message, code: 'SQLITE_ERROR' } }); break; }
      }
      send(200, { baton, base_url: null, results });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, token: 'test-token', log, close: () => new Promise((r) => server.close(r)) })));
}
module.exports = { start };
