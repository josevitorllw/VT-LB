// OS 5 DADOS PEDIDOS DEPOIS QUE O CERTIFICADO É ACEITO
//
// Para trocar um campo, mude o "label" (o que aparece na tela) e o "tipo".
// Tipos: "texto", "telefone", "email", "data", "numero", "opcoes" (lista com "opcoes"), "texto-longo".
// "obrigatorio: false" deixa o campo opcional.
// Evite mudar o "id" depois que o site estiver no ar: é ele que liga as respostas já salvas à coluna do painel.

module.exports = [
  { id: 'whatsapp', label: 'WhatsApp com DDD', tipo: 'telefone', placeholder: '(11) 91234-5678', obrigatorio: true },
  { id: 'nascimento', label: 'Data de nascimento', tipo: 'data', obrigatorio: true },
  { id: 'cidade', label: 'Cidade', tipo: 'texto', obrigatorio: true },
  {
    id: 'estado',
    label: 'Estado',
    tipo: 'opcoes',
    opcoes: ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE',
      'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'],
    obrigatorio: true,
  },
  { id: 'instagram', label: 'Instagram', tipo: 'texto', placeholder: '@seuperfil', obrigatorio: false },
];
