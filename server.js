'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Chargement minimal de .env (sans dépendance)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const { createApp } = require('./src/app');
const app = createApp();
const port = Number(process.env.PORT || 3000);
app.ready.then(() => {
  app.server.listen(port, '0.0.0.0', () => {
    console.log(`DIGIFASO démarré sur http://localhost:${port} (base : ${app.db.kind})`);
    const b = app.bootstrapInfo;
    if (b) {
      console.log(`\nCompte administrateur créé : ${b.email}`);
      if (b.generated) console.log(`Mot de passe temporaire (affiché une seule fois) : ${b.password}`);
      console.log('Changez ce mot de passe dès la première connexion.\n');
    }
  });
}).catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.server.close(() => process.exit(0)));
