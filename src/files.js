// Onde ficam os arquivos do site que NÃO vão para o GitHub: banco de dados, ebook, prêmio e foto da capa.
//
// - No seu computador: pasta "data/" do projeto (e a pasta "private/", como antes).
// - Na Railway: o "volume" permanente (a Railway informa o caminho em RAILWAY_VOLUME_MOUNT_PATH).
//   Sem volume, tudo seria apagado a cada atualização do site.
//
// O ebook, o prêmio e a foto podem ser enviados pelo painel /admin (ficam em <pasta de dados>/arquivos).

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const env = process.env;
const dataDir = env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || path.join(config.root, 'data');
const uploadsDir = path.join(dataDir, 'arquivos');
fs.mkdirSync(uploadsDir, { recursive: true });

const resolve = (value) => (path.isAbsolute(value) ? value : path.join(config.root, value));
const firstExisting = (candidates) => candidates.find((file) => file && fs.existsSync(file)) || null;
const uploaded = (base) => {
  const name = fs.readdirSync(uploadsDir).find((f) => path.parse(f).name === base);
  return name ? path.join(uploadsDir, name) : null;
};

// O que pode ser enviado pelo painel, e como conferir que o arquivo é do tipo certo.
const KINDS = {
  ebook: {
    label: 'Ebook (PDF)',
    extensions: ['.pdf'],
    check: (buf) => buf.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  premio: {
    label: 'Prêmio',
    extensions: ['.pdf', '.zip', '.epub', '.mp3', '.mp4', '.jpg', '.jpeg', '.png'],
    check: () => true,
  },
  capa: {
    label: 'Foto da página inicial',
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    check: (buf) => buf[0] === 0xff // JPG
      || buf.subarray(0, 4).toString('latin1') === '\x89PNG'
      || buf.subarray(8, 12).toString('latin1') === 'WEBP',
  },
};

function ebookFile() {
  return firstExisting([env.EBOOK_FILE && resolve(env.EBOOK_FILE), uploaded('ebook'), resolve('private/ebook.pdf')]);
}

function prizeFile() {
  if (env.PRIZE_FILE === '') return null; // PRIZE_FILE vazio = prêmio sem arquivo
  return firstExisting([env.PRIZE_FILE && resolve(env.PRIZE_FILE), uploaded('premio'), resolve('private/premio.pdf')]);
}

function coverFile() {
  return firstExisting([uploaded('capa'), resolve('public/img/capa.jpg')]);
}

// Salva um arquivo enviado pelo painel (substitui o anterior do mesmo tipo).
function saveUpload(kind, originalName, buffer) {
  const spec = KINDS[kind];
  if (!spec) throw new Error('Tipo de arquivo desconhecido.');
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (!spec.extensions.includes(ext)) throw new Error(`Formato não aceito. Use: ${spec.extensions.join(', ')}`);
  if (!buffer || !buffer.length) throw new Error('Arquivo vazio.');
  if (!spec.check(buffer)) throw new Error('O conteúdo do arquivo não confere com o formato.');

  const target = path.join(uploadsDir, `${kind}${ext}`);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, buffer);
  for (const f of fs.readdirSync(uploadsDir)) {
    if (path.parse(f).name === kind && path.join(uploadsDir, f) !== target) fs.unlinkSync(path.join(uploadsDir, f));
  }
  fs.renameSync(tmp, target);
  return target;
}

function describe(file) {
  if (!file) return null;
  const stat = fs.statSync(file);
  return { name: path.basename(file), size: stat.size, updatedAt: stat.mtime, uploaded: file.startsWith(uploadsDir) };
}

module.exports = { dataDir, uploadsDir, KINDS, ebookFile, prizeFile, coverFile, saveUpload, describe };
