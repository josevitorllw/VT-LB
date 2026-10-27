const crypto = require('node:crypto');

// Sem 0/O, 1/I/L para evitar confusão ao digitar o código.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChars(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

// Código do certificado, ex.: VTLB-8F3K-2Q9X
function certificateCode() {
  return `VTLB-${randomChars(4)}-${randomChars(4)}`;
}

function normalizeCertificateCode(input) {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean.startsWith('VTLB') || clean.length !== 12) return null;
  return `VTLB-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = { certificateCode, normalizeCertificateCode, token };
