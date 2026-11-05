const fs = require('fs');

// Ler o arquivo
const dados = JSON.parse(fs.readFileSync('vizinha-dados.json', 'utf8'));

// Função para limpar espaços
function limpar(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => limpar(item));
  } else if (obj && typeof obj === 'object') {
    const limpo = {};
    for (const chave in obj) {
      const chaveLimpa = chave.trim();
      const valor = obj[chave];
      if (typeof valor === 'string') {
        limpo[chaveLimpa] = valor.trim();
      } else {
        limpo[chaveLimpa] = limpar(valor);
      }
    }
    return limpo;
  }
  return obj;
}

// Limpar e salvar
const jsonLimpo = limpar(dados);
fs.writeFileSync('vizinha-dados-limpo.json', JSON.stringify(jsonLimpo, null, 2), 'utf8');

console.log('✅ JSON limpo com sucesso!');
console.log(`- ${jsonLimpo.providers.length} prestadores`);
console.log(`- ${jsonLimpo.residents.length} moradores`);