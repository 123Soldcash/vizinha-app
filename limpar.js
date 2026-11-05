const fs = require('fs');

const arquivo = 'vizinha-dados.json';
const texto = fs.readFileSync(arquivo, 'utf8');
const dados = JSON.parse(texto);

function limpar(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => limpar(item));
  } else if (obj !== null && typeof obj === 'object') {
    const novo = {};
    for (const chave in obj) {
      const chaveLimpa = chave.trim();
      const valor = obj[chave];
      if (typeof valor === 'string') {
        novo[chaveLimpa] = valor.trim();
      } else {
        novo[chaveLimpa] = limpar(valor);
      }
    }
    return novo;
  }
  return obj;
}

const limpo = limpar(dados);
fs.writeFileSync(arquivo, JSON.stringify(limpo, null, 2), 'utf8');

console.log('✅ Arquivo limpo com sucesso!');
console.log('Prestadores:', limpo.providers.length);
console.log('Moradores:', limpo.residents.length);