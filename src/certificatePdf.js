// Gera o PDF "ebook + certificado" de cada comprador e lê o código de volta quando
// a pessoa anexa o arquivo na página de cadastro.
//
// O código do certificado vai nos metadados do PDF (campo "Keywords"). É esse código,
// junto com o CPF de quem comprou, que valida o cadastro.

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const config = require('./config');
const { normalizeCertificateCode } = require('./codes');
const { ebookFile: getEbookFile } = require('./files');

const KEYWORD_PREFIX = 'vtlb-cert:';
const BLACK = rgb(0.07, 0.07, 0.07);
const RED = rgb(0.86, 0.15, 0.15);
const DARK = BLACK;
const MUTED = rgb(0.37, 0.37, 0.37);

// As fontes padrão do PDF só aceitam caracteres latinos (acentos ok, emoji não).
const latin = (text) => String(text).replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim();

function formatDate(sqliteDate) {
  return new Date(`${sqliteDate.replace(' ', 'T')}Z`).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo',
  });
}

async function drawCertificatePage(doc, cert) {
  const page = doc.addPage([842, 595]); // A4 deitado
  const { width, height } = page.getSize();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const courier = await doc.embedFont(StandardFonts.CourierBold);

  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: RED, borderWidth: 6 });
  page.drawRectangle({ x: 30, y: 30, width: width - 60, height: height - 60, borderColor: BLACK, borderWidth: 1 });

  const center = (text, y, font, size, color = DARK) => {
    const value = latin(text);
    page.drawText(value, { x: (width - font.widthOfTextAtSize(value, size)) / 2, y, size, font, color });
  };

  center('CERTIFICADO', 470, bold, 40, RED);
  center('Certificamos que', 410, regular, 16, MUTED);
  center(cert.name, 362, serif, 34);
  page.drawLine({ start: { x: 220, y: 350 }, end: { x: width - 220, y: 350 }, thickness: 1, color: BLACK });
  center(`adquiriu o ebook "${config.ebook.title}"`, 318, regular, 16);
  center(`em ${formatDate(cert.issued_at)}.`, 296, regular, 16);
  center('Código do certificado', 236, regular, 12, MUTED);
  center(cert.code, 208, courier, 26, RED);
  center('Para ganhar seu prêmio, anexe ESTE ARQUIVO PDF na página de cadastro:', 120, bold, 12, MUTED);
  center(`${config.publicUrl}/cadastro`, 100, regular, 12, MUTED);
  return page;
}

async function buildEbookWithCertificate(cert) {
  const doc = await PDFDocument.create();
  await drawCertificatePage(doc, cert);

  const ebookFile = getEbookFile();
  if (ebookFile && path.extname(ebookFile).toLowerCase() === '.pdf' && fs.existsSync(ebookFile)) {
    try {
      const ebook = await PDFDocument.load(fs.readFileSync(ebookFile), { ignoreEncryption: true });
      const pages = await doc.copyPages(ebook, ebook.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
    } catch (err) {
      console.error('[pdf] não consegui juntar o ebook ao certificado:', err.message);
    }
  } else {
    console.warn('[pdf] ebook não encontrado em', ebookFile, '- enviando só o certificado');
  }

  doc.setTitle(latin(`${config.ebook.title} - Certificado de ${cert.name}`));
  doc.setSubject(`Certificado ${cert.code}`);
  doc.setKeywords([`${KEYWORD_PREFIX}${cert.code}`]);
  doc.setProducer('VT LB');
  return doc.save();
}

// Devolve o código do certificado contido no PDF, ou null se não for um certificado nosso.
async function readCertificateCode(bytes) {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const keywords = doc.getKeywords() || '';
    const match = keywords.match(/vtlb-cert:(VTLB-[A-Z0-9]{4}-[A-Z0-9]{4})/);
    return match ? normalizeCertificateCode(match[1]) : null;
  } catch {
    return null;
  }
}

module.exports = { buildEbookWithCertificate, readCertificateCode };
