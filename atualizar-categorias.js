const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./vizinha.db');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err); else resolve(this);
    });
  });
}

async function atualizarCategorias() {
  try {
    // 1. Atualizar nomes dos grupos existentes
    await run(`UPDATE categorias SET grupo = 'Obras e Reformas' WHERE grupo = 'Reformas e Obras'`);
    await run(`UPDATE categorias SET grupo = 'Saúde e Home Care' WHERE grupo = 'Saúde'`);
    await run(`UPDATE categorias SET grupo = 'Beleza e Bem-Estar' WHERE grupo = 'Beleza e Estética'`);
    await run(`UPDATE categorias SET grupo = 'Assistência Técnica e Instalações' WHERE grupo = 'Eletrônicos e Tecnologia'`);
    console.log('✅ Grupos atualizados.');

    // 2. Adicionar categorias faltantes
    const novasCategorias = [
      { nome: 'Gesseiro', grupo: 'Obras e Reformas', cor: '#d97706', icone: '🏗️' },
      { nome: 'Pedreiro', grupo: 'Obras e Reformas', cor: '#d97706', icone: '🧱' },
      { nome: 'Coleta de exames', grupo: 'Saúde e Home Care', cor: '#dc2626', icone: '🩸' },
      { nome: 'Enfermeiro', grupo: 'Saúde e Home Care', cor: '#dc2626', icone: '💉' },
      { nome: 'Fisioterapeuta', grupo: 'Saúde e Home Care', cor: '#dc2626', icone: '' },
      { nome: 'Cabeleireiro', grupo: 'Beleza e Bem-Estar', cor: '#db2777', icone: '💇' },
      { nome: 'Maquiador', grupo: 'Beleza e Bem-Estar', cor: '#db2777', icone: '💄' },
      { nome: 'Massagista', grupo: 'Beleza e Bem-Estar', cor: '#db2777', icone: '💆' },
      { nome: 'Geladeira', grupo: 'Assistência Técnica e Instalações', cor: '#7c3aed', icone: '🧊' },
      { nome: 'Internet', grupo: 'Assistência Técnica e Instalações', cor: '#7c3aed', icone: '🌐' },
      { nome: 'Máquina de lavar', grupo: 'Assistência Técnica e Instalações', cor: '#7c3aed', icone: '🫧' },
      { nome: 'TV a cabo', grupo: 'Assistência Técnica e Instalações', cor: '#7c3aed', icone: '' },
      { nome: 'Água', grupo: 'Alimentação e Entregas', cor: '#059669', icone: '🚰' },
      { nome: 'Delivery de comida', grupo: 'Alimentação e Entregas', cor: '#059669', icone: '🛵' },
      { nome: 'Gás', grupo: 'Alimentação e Entregas', cor: '#059669', icone: '🔥' },
      { nome: 'Minimercado', grupo: 'Alimentação e Entregas', cor: '#059669', icone: '🛒' },
      { nome: 'Caixa de gordura', grupo: 'Casa e Limpeza', cor: '#2563eb', icone: '🍳' },
      { nome: 'Cozinheira', grupo: 'Casa e Limpeza', cor: '#2563eb', icone: '🥘' },
      { nome: 'Deep cleaning', grupo: 'Casa e Limpeza', cor: '#2563eb', icone: '✨' },
      { nome: 'Limpeza de caixa d\'água', grupo: 'Casa e Limpeza', cor: '#2563eb', icone: '💧' },
      { nome: 'Limpeza de vidros', grupo: 'Casa e Limpeza', cor: '#2563eb', icone: '🪟' },
      { nome: 'Passadeira', grupo: 'Casa e Limpeza', cor: '#2563eb', icone: '👕' },
      { nome: 'Lava car', grupo: 'Família e Área Externa', cor: '#475569', icone: '🚗' },
      { nome: 'Piscineiro', grupo: 'Família e Área Externa', cor: '#475569', icone: '' },
    ];

    // Adicionar coluna icone se não existir
    try {
      await run(`ALTER TABLE categorias ADD COLUMN icone TEXT DEFAULT ''`);
      console.log('✅ Coluna icone adicionada.');
    } catch(e) {
      console.log('ℹ️  Coluna icone já existe.');
    }

    let catId = 100;
    for (const cat of novasCategorias) {
      await run(
        `INSERT OR IGNORE INTO categorias (id, condominio_id, nome, grupo, cor, em_uso, icone) VALUES (?, 1, ?, ?, ?, 1, ?)`,
        [catId, cat.nome, cat.grupo, cat.cor, cat.icone]
      );
      catId++;
    }
    console.log(`✅ ${novasCategorias.length} novas categorias adicionadas.`);

    console.log('\n CATEGORIAS ATUALIZADAS COM SUCESSO!');
    console.log('Agora reinicie o servidor: npm start');
  } catch (err) {
    console.error('❌ ERRO:', err.message);
  } finally {
    db.close();
  }
}

atualizarCategorias();