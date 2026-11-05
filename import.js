const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const db = new sqlite3.Database('./vizinha.db');
const dados = JSON.parse(fs.readFileSync(path.join(__dirname, 'vizinha-dados.json'), 'utf8'));

function normalizarTel(tel) {
  if (!tel) return null;
  let limpo = tel.replace(/\D/g, '');
  if (limpo.startsWith('55') && (limpo.length === 13 || limpo.length === 14)) {
    limpo = limpo.slice(2);
  }
  return limpo;
}

const gruposCategorias = {
  'Diarista': 'Casa e Limpeza',
  'Mensalista': 'Casa e Limpeza',
  'Babá': 'Casa e Limpeza',
  'Cuidador de idoso': 'Saúde',
  'Lavanderia': 'Casa e Limpeza',
  'Manicure': 'Beleza e Estética',
  'Terapia': 'Saúde',
  'Médicos': 'Saúde',
  'Organização': 'Casa e Limpeza',
  'Pintor': 'Reformas e Obras',
  'Eletricista': 'Reformas e Obras',
  'Encanador': 'Reformas e Obras',
  'Azulejista': 'Reformas e Obras',
  'Marceneiro': 'Reformas e Obras',
  'Jardineiro': 'Casa e Limpeza',
  'Ar-condicionado': 'Eletrônicos e Tecnologia',
  'Eletrodomésticos': 'Eletrônicos e Tecnologia',
  'Dedetizador': 'Casa e Limpeza',
};

const coresPorGrupo = {
  'Casa e Limpeza': '#3B82F6',
  'Reformas e Obras': '#F59E0B',
  'Eletrônicos e Tecnologia': '#8B5CF6',
  'Saúde': '#10B981',
  'Beleza e Estética': '#EC4899',
  'Pets': '#8B5CF6',
  'Transporte': '#6B7280',
  'Outros': '#6B7280',
};

function getGrupo(cat) { return gruposCategorias[cat] || 'Outros'; }
function getCor(cat) { return coresPorGrupo[getGrupo(cat)] || '#6B7280'; }

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
    let pulados = 0;

    for (const p of dados.providers) {
      const tel = normalizarTel(p.tel);
      if (!tel || tel.length < 10) {
        console.log(`⚠️  Tel inválido: ${p.nome} (${p.tel})`);
        pulados++;
        continue;
      }

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
      } catch (err) {
        if (err.message.includes('UNIQUE')) {
          console.log(`⚠️  Duplicado: ${p.nome}`);
          pulados++;
        } else {
          console.log(`❌ Erro ${p.nome}: ${err.message}`);
        }
      }
    }
    console.log(`✅ ${importados} prestadores importados. (${pulados} pulados)`);

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

    console.log('\n🎉 IMPORTAÇÃO CONCLUÍDA COM SUCESSO!');
    console.log('Agora execute: npm start');
  } catch (err) {
    console.error('\n❌ ERRO FATAL:', err.message);
    console.error(err.stack);
  } finally {
    db.close();
  }
}

importar();