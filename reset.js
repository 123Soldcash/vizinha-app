const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

console.log('🔄 Limpando JSON...');
const dadosBrutos = JSON.parse(fs.readFileSync('vizinha-dados.json', 'utf8'));

function limpar(obj) {
  if (Array.isArray(obj)) return obj.map(limpar);
  if (obj && typeof obj === 'object') {
    const novo = {};
    for (const chave in obj) {
      const valor = obj[chave];
      novo[chave.trim()] = typeof valor === 'string' ? valor.trim() : limpar(valor);
    }
    return novo;
  }
  return obj;
}

const dados = limpar(dadosBrutos);
fs.writeFileSync('vizinha-dados.json', JSON.stringify(dados, null, 2), 'utf8');
console.log('✅ JSON limpo!');

function normalizarTel(tel) {
  if (!tel) return null;
  let limpo = tel.replace(/\D/g, '');
  if (limpo.startsWith('55') && (limpo.length === 13 || limpo.length === 14)) {
    limpo = limpo.slice(2);
  }
  return limpo;
}

const gruposCategorias = {
  'Diarista': 'Casa e Limpeza', 'Mensalista': 'Casa e Limpeza', 'Babá': 'Casa e Limpeza',
  'Cuidador de idoso': 'Saúde e Home Care', 'Lavanderia': 'Casa e Limpeza',
  'Manicure': 'Beleza e Bem-Estar', 'Terapia': 'Saúde e Home Care', 'Médicos': 'Saúde e Home Care',
  'Organização': 'Casa e Limpeza', 'Pintor': 'Obras e Reformas', 'Eletricista': 'Obras e Reformas',
  'Encanador': 'Obras e Reformas', 'Azulejista': 'Obras e Reformas', 'Marceneiro': 'Obras e Reformas',
  'Jardineiro': 'Família e Área Externa', 'Ar-condicionado': 'Assistência Técnica e Instalações',
  'Eletrodomésticos': 'Assistência Técnica e Instalações', 'Dedetizador': 'Casa e Limpeza',
  'Gesseiro': 'Obras e Reformas', 'Pedreiro': 'Obras e Reformas',
  'Coleta de exames': 'Saúde e Home Care', 'Enfermeiro': 'Saúde e Home Care',
  'Fisioterapeuta': 'Saúde e Home Care', 'Cabeleireiro': 'Beleza e Bem-Estar',
  'Maquiador': 'Beleza e Bem-Estar', 'Massagista': 'Beleza e Bem-Estar',
  'Geladeira': 'Assistência Técnica e Instalações', 'Internet': 'Assistência Técnica e Instalações',
  'Máquina de lavar': 'Assistência Técnica e Instalações', 'TV a cabo': 'Assistência Técnica e Instalações',
  'Água': 'Alimentação e Entregas', 'Delivery de comida': 'Alimentação e Entregas',
  'Gás': 'Alimentação e Entregas', 'Minimercado': 'Alimentação e Entregas',
  'Caixa de gordura': 'Casa e Limpeza', 'Cozinheira': 'Casa e Limpeza',
  'Deep cleaning': 'Casa e Limpeza', 'Limpeza de caixa d\'água': 'Casa e Limpeza',
  'Limpeza de vidros': 'Casa e Limpeza', 'Passadeira': 'Casa e Limpeza',
  'Lava car': 'Família e Área Externa', 'Piscineiro': 'Família e Área Externa',
};

const coresPorGrupo = {
  'Casa e Limpeza': '#4FB8B8', 'Obras e Reformas': '#d97706',
  'Assistência Técnica e Instalações': '#7c3aed', 'Saúde e Home Care': '#dc2626',
  'Beleza e Bem-Estar': '#db2777', 'Família e Área Externa': '#475569',
  'Alimentação e Entregas': '#059669', 'Outros': '#6b7280'
};

function getGrupo(cat) { return gruposCategorias[cat] || 'Outros'; }
function getCor(cat) { return coresPorGrupo[getGrupo(cat)] || '#6b7280'; }

const db = new sqlite3.Database('./vizinha.db');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err); else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}

async function importar() {
  try {
    const catsSet = new Set();
    dados.providers.forEach(p => {
      if (p.cats && Array.isArray(p.cats)) p.cats.forEach(c => catsSet.add(c.trim()));
    });

    const categoriasMap = {};
    let catId = 1;
    for (const cat of catsSet) {
      await run(
        `INSERT OR IGNORE INTO categorias (id, condominio_id, nome, grupo, cor, em_uso) VALUES (?, 1, ?, ?, ?, 1)`,
        [catId, cat, getGrupo(cat), getCor(cat)]
      );
      categoriasMap[cat] = catId;
      catId++;
    }
    console.log(`✅ ${catsSet.size} categorias criadas.`);

    let importados = 0;
    for (const p of dados.providers) {
      const tel = normalizarTel(p.tel);
      if (!tel || tel.length < 10) continue;

      const cats = (p.cats || []).map(c => c.trim());
      const catPrincipal = cats[0] || null;
      const catPrincipalId = catPrincipal ? categoriasMap[catPrincipal] : null;
      const outrasCats = cats.slice(1);
      const outrasCatsIds = outrasCats.length > 0
        ? JSON.stringify(outrasCats.map(c => categoriasMap[c]).filter(Boolean))
        : null;

      let diferencial = (p.dif || '').trim();
      if (!diferencial && p.indicado) diferencial = p.indicado.trim();
      const blacklisted = p.bl ? 1 : 0;

      try {
        await run(
          `INSERT OR IGNORE INTO prestadores 
           (id, condominio_id, nome, telefone, tipo, categoria_principal_id, outras_categorias_ids, diferencial, blacklisted, cadastrado_por_morador_id)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [p.id, p.nome.trim(), tel, p.tipo || 'Autônomo', catPrincipalId, outrasCatsIds, diferencial, blacklisted]
        );
        importados++;
      } catch (err) {}
    }
    console.log(`✅ ${importados} prestadores importados.`);

    let precosImportados = 0;
    for (const p of dados.providers) {
      if (p.precos && Array.isArray(p.precos) && p.precos.length > 0) {
        const tel = normalizarTel(p.tel);
        const prestador = await get(`SELECT id FROM prestadores WHERE telefone = ?`, [tel]);
        if (prestador) {
          for (const pr of p.precos) {
            if (pr.valor && pr.tipo) {
              await run(
                `INSERT OR IGNORE INTO precos (condominio_id, prestador_id, tipo_preco, valor, data_referencia, inclui_transporte, inclui_produtos)
                 VALUES (1, ?, ?, ?, '2026-10-29', 0, 0)`,
                [prestador.id, pr.tipo, pr.valor]
              );
              precosImportados++;
            }
          }
        }
      }
    }
    console.log(`✅ ${precosImportados} preços importados.`);

    for (const r of dados.residents) {
      const tel = normalizarTel(r.tel);
      await run(
        `INSERT OR REPLACE INTO moradores 
         (id, condominio_id, nome, unidade, telefone, status, eh_admin, aceite_termos_data)
         VALUES (?, 1, ?, ?, ?, 'ativo', ?, CURRENT_TIMESTAMP)`,
        [r.id, r.nome.trim(), r.unidade, tel, r.admin ? 1 : 0]
      );
    }
    console.log(`✅ ${dados.residents.length} moradores importados.`);

    console.log('\n🎉 TUDO PRONTO! Agora execute: npm start');
  } catch (err) {
    console.error('❌ ERRO:', err.message);
  } finally {
    db.close();
  }
}

importar();