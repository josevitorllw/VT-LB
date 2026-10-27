function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo deu errado. Tente novamente.');
  return data;
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const original = button.textContent;
  button.textContent = 'Copiado!';
  setTimeout(() => { button.textContent = original; }, 2000);
}

// Sem foto ainda: mostra um espaço reservado. Confere também se a imagem já falhou antes do script rodar.
function setupCover(img) {
  const placeholder = () => {
    img.src = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="100%" height="100%" fill="#dcdfe4"/>' +
      '<rect x="730" y="380" width="140" height="100" rx="14" fill="none" stroke="#9ca3af" stroke-width="10"/>' +
      '<circle cx="800" cy="430" r="28" fill="none" stroke="#9ca3af" stroke-width="10"/>' +
      '<text x="50%" y="600" font-family="sans-serif" font-size="44" fill="#9ca3af" text-anchor="middle">Coloque a foto em public/img/capa.jpg</text></svg>');
  };
  if (img.complete && !img.naturalWidth) placeholder();
  else img.addEventListener('error', placeholder, { once: true });
}
