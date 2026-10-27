// Valida as respostas dos campos definidos em campos.js.
const campos = require('./campos');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Versão dos campos que vai para a página (sem nada além do necessário para montar o formulário).
function publicFields() {
  return campos.map(({ id, label, tipo, placeholder, opcoes, obrigatorio }) => ({
    id, label, tipo, placeholder: placeholder || '', opcoes: opcoes || null, obrigatorio: obrigatorio !== false,
  }));
}

// Devolve { values } com as respostas limpas, ou { error } com a mensagem para a pessoa.
function validateAnswers(input) {
  const values = {};
  for (const campo of campos) {
    let value = String((input && input[campo.id]) ?? '').trim().slice(0, 500);
    const required = campo.obrigatorio !== false;

    if (!value) {
      if (required) return { error: `Preencha o campo "${campo.label}".` };
      values[campo.id] = '';
      continue;
    }

    switch (campo.tipo) {
      case 'telefone':
        value = value.replace(/\D/g, '');
        if (value.length < 10 || value.length > 11) return { error: `"${campo.label}": informe o número com DDD.` };
        break;
      case 'email':
        value = value.toLowerCase();
        if (!EMAIL_RE.test(value)) return { error: `"${campo.label}": e-mail inválido.` };
        break;
      case 'data': {
        const date = new Date(`${value}T12:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date > new Date()) {
          return { error: `"${campo.label}": data inválida.` };
        }
        break;
      }
      case 'numero':
        if (!/^-?\d+([.,]\d+)?$/.test(value)) return { error: `"${campo.label}": informe só números.` };
        break;
      case 'opcoes':
        if (!(campo.opcoes || []).includes(value)) return { error: `"${campo.label}": escolha uma das opções.` };
        break;
      default:
        break;
    }
    values[campo.id] = value;
  }
  return { values };
}

module.exports = { campos, publicFields, validateAnswers };
