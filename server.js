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
const { server, bootstrapInfo } = createApp();
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`DIGIFASO démarré sur http://localhost:${port}`);
  if (bootstrapInfo) {
    console.log(`\nCompte administrateur créé : ${bootstrapInfo.email}`);
    if (bootstrapInfo.generated) console.log(`Mot de passe temporaire (affiché une seule fois) : ${bootstrapInfo.password}`);
    console.log('Changez ce mot de passe dès la première connexion.\n');
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
