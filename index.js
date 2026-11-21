'use strict';
// Point d'entrée Vercel : toutes les URLs /api/* arrivent ici (voir vercel.json).
// Variables d'environnement requises : TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ADMIN_EMAIL, ADMIN_PASSWORD.
const { createApp } = require('../src/app');
let app;
module.exports = (req, res) => {
  if (!app) app = createApp({ production: true });
  return app.handler(req, res);
};
