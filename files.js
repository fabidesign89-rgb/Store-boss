'use strict';
// Contrôles de sécurité des fichiers téléversés (extension autorisée + signature binaire + taille).
const MAX_FILE = 3 * 1024 * 1024; // limite de corps des fonctions Vercel : 4,5 Mo (base64 ≈ +33 %)
const RULES = {
  png: { mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  gif: { mime: 'image/gif', magic: [[0x47, 0x49, 0x46, 0x38]] },
  webp: { mime: 'image/webp', magic: [[0x52, 0x49, 0x46, 0x46]] },
  pdf: { mime: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [[0x50, 0x4b, 0x03, 0x04]] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: [[0x50, 0x4b, 0x03, 0x04]] },
  txt: { mime: 'text/plain; charset=utf-8', magic: null },
};
function checkFile(name, buf) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  const rule = RULES[ext];
  if (!rule) return { error: `Type de fichier non autorisé (.${ext}). Autorisés : ${Object.keys(RULES).join(', ')}.` };
  if (!buf.length) return { error: 'Fichier vide.' };
  if (buf.length > MAX_FILE) return { error: 'Fichier trop volumineux (3 Mo maximum).' };
  if (rule.magic && !rule.magic.some((m) => m.every((b, i) => buf[i] === b))) return { error: 'Le contenu du fichier ne correspond pas à son extension.' };
  if (ext === 'txt' && buf.includes(0)) return { error: 'Fichier texte invalide.' };
  return { ext, mime: rule.mime };
}
const safeName = (n) => String(n).replace(/[^\w.\- àâäéèêëîïôöùûüç()]/gi, '_').slice(0, 120) || 'fichier';
module.exports = { checkFile, safeName, MAX_FILE, ALLOWED: Object.keys(RULES) };
