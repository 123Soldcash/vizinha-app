const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./vizinha.db');

db.serialize(() => {
  // Criar categorias iniciais
  const categorias = [
    { nome: 'Diarista', grupo: 'Casa e Limpeza', cor: '#3B82F6' },
    { nome: 'Eletricista', grupo: 'Reformas e Obras', cor: '#F59E0B' },
    { nome: 'Encanador', grupo: 'Reformas e Obras', cor: '#F59E0B' },
    { nome: 'Pintor', grupo: 'Reformas e Obras', cor: '#F59E0B' },
    { nome: 'Médico', grupo: 'Saúde', cor: '#10B981' },
    { nome: 'Dentista', grupo: 'Saúde', cor: '#10B981' },
    { nome: 'Cabeleireiro', grupo: 'Beleza e Estética', cor: '#EC4899' },
    { nome: 'Manicure', grupo: 'Beleza e Estética', cor: '#EC4899' },
    { nome: 'Pet Sitter', grupo: 'Pets', cor: '#8B5CF6' },
    { nome: 'Adestrador', grupo: 'Pets', cor: '#8B5CF6' },
    { nome: 'Motorista', grupo: 'Transporte', cor: '#6B7280' },
    { nome: 'Entregador', grupo: 'Transporte', cor: '#6B7280' }
  ];

  const stmt = db.prepare(`INSERT INTO categorias (condominio_id, nome, grupo, cor) VALUES (1, ?, ?, ?)`);
  categorias.forEach(cat => {
    stmt.run(cat.nome, cat.grupo, cat.cor);
  });
  stmt.finalize();

  // Criar prestadores de exemplo
  const prestadores = [
    { nome: 'Maria Silva', telefone: '11988888888', tipo: 'Autônomo', categoria: 'Diarista', diferencial: '10 anos de experiência' },
    { nome: 'João Santos', telefone: '11977777777', tipo: 'Autônomo', categoria: 'Eletricista', diferencial: 'Atende emergências 24h' },
    { nome: 'Ana Costa', telefone: '11966666666', tipo: 'Empresa', categoria: 'Cabeleireiro', diferencial: 'Salão completo' },
    { nome: 'Carlos Oliveira', telefone: '11955555555', tipo: 'Autônomo', categoria: 'Encanador', diferencial: 'Orçamento gratuito' },
    { nome: 'Pet Love', telefone: '11944444444', tipo: 'Empresa', categoria: 'Pet Sitter', diferencial: 'Cuidado personalizado' }
  ];

  const stmtPrest = db.prepare(`INSERT INTO prestadores (condominio_id, nome, telefone, tipo, categoria_principal_id, diferencial, cadastrado_por_morador_id) 
    VALUES (1, ?, ?, ?, (SELECT id FROM categorias WHERE nome = ?), ?, 1)`);
  prestadores.forEach(p => {
    stmtPrest.run(p.nome, p.telefone, p.tipo, p.categoria, p.diferencial);
  });
  stmtPrest.finalize();

  console.log('Dados de exemplo criados com sucesso!');
  db.close();
});