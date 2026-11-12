const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const VOLUME = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const dbPath = VOLUME ? path.join(VOLUME, 'vizinha.db') : path.join(__dirname, 'vizinha.db');
const db = new sqlite3.Database(dbPath);
const SECRET = process.env.JWT_SECRET || 'chave_secreta_vizinha_2024';

const CATEGORIAS_PADRAO = {
  'Casa e Limpeza': ['Diarista', 'Mensalista', 'Lavanderia', 'Passadeira', 'Organização', 'Deep cleaning', "Limpeza de caixa d'água", 'Limpeza de vidros', 'Cozinheira', 'Dedetizador', 'Caixa de gordura', 'Cortinas'],
  'Obras e Reformas': ['Pintor', 'Eletricista', 'Encanador', 'Azulejista', 'Marceneiro', 'Gesseiro', 'Pedreiro', 'Reformas em Geral', 'Calhas', 'Reforma de Móveis e Estofados'],
  'Assistência Técnica e Instalações': ['Ar-condicionado', 'Eletrodomésticos', 'Geladeira', 'Máquina de lavar', 'Internet', 'TV a cabo', 'Vidros', 'Porta e Janelas', 'Tela de Proteção', 'Solar Instalação', 'Solar Manutenção', 'Manutenção de Bicicletas'],
  'Saúde e Home Care': ['Médico', 'Dentista', 'Psicólogo', 'Fonoaudióloga', 'Fisioterapeuta', 'Enfermeiro', 'Coleta de exames', 'Cuidador de idoso', 'Terapia', 'Nutricionista'],
  'Beleza e Bem-Estar': ['Manicure', 'Cabeleireiro', 'Maquiador', 'Massagista'],
  'Família e Área Externa': ['Babá', 'Jardineiro', 'Piscineiro', 'Lava car', 'Mudanças e Fretes', 'Corretor de Imóveis'],
  'Alimentação e Entregas': ['Água', 'Gás', 'Minimercado', 'Delivery de comida', 'Doces e Bolos', 'Comida Caseira e Marmitas', 'Pães', 'Padaria', 'Restaurante', 'Pizzaria', 'Lanchonete', 'Marmitaria', 'Açaí e Sorveteria', 'Adega e Bebidas'],
  'Educação e Idiomas': ['Professor de Inglês', 'Espanhol', 'Professor de Tênis'],
  'Pets e Animais': ['Pet Shop', 'Cuidador de Pet'],
  'Outros': ['Artesanato e Personalizados', 'Outra']
};
const CORES_GRUPO = { 'Casa e Limpeza': '#4FB8B8', 'Obras e Reformas': '#d97706', 'Assistência Técnica e Instalações': '#7c3aed', 'Saúde e Home Care': '#dc2626', 'Beleza e Bem-Estar': '#db2777', 'Família e Área Externa': '#475569', 'Alimentação e Entregas': '#059669', 'Educação e Idiomas': '#8b5cf6', 'Pets e Animais': '#10b981', 'Outros': '#6b7280' };

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS condominios (id INTEGER PRIMARY KEY, nome TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS moradores (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, unidade TEXT, telefone TEXT UNIQUE, codigo_sms TEXT, codigo_expira_em DATETIME, status TEXT DEFAULT 'pendente', eh_admin INTEGER DEFAULT 0, aceite_termos_data DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS categorias (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, grupo TEXT, cor TEXT, em_uso INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS prestadores (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, telefone TEXT UNIQUE, tipo TEXT, categoria_principal_id INTEGER, outras_categorias_ids TEXT, diferencial TEXT, endereco TEXT, email TEXT, blacklisted INTEGER DEFAULT 0, cadastrado_por_morador_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS avaliacoes (id INTEGER PRIMARY KEY, condominio_id INTEGER, prestador_id INTEGER, morador_telefone TEXT, tipo TEXT, motivos TEXT, comentario TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(prestador_id, morador_telefone))`);
  db.run(`CREATE TABLE IF NOT EXISTS precos (id INTEGER PRIMARY KEY, condominio_id INTEGER, prestador_id INTEGER, tipo_preco TEXT, valor REAL, data_referencia DATE, inclui_transporte INTEGER DEFAULT 0, inclui_produtos INTEGER DEFAULT 0, telefone TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY, condominio_id INTEGER, morador_id INTEGER, tipo TEXT, mensagem TEXT, lida INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`ALTER TABLE precos ADD COLUMN telefone TEXT`, () => {});
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_nome ON categorias(condominio_id, nome)`);

  db.run(`INSERT OR IGNORE INTO condominios (id, nome) VALUES (1, 'Villagio Bourbon')`);
  db.run(`INSERT OR IGNORE INTO moradores (condominio_id, nome, unidade, telefone, status, eh_admin, aceite_termos_data) VALUES (1, 'Administrador', '101', '11999999999', 'ativo', 1, CURRENT_TIMESTAMP)`);

  const stmt = db.prepare(`INSERT OR IGNORE INTO categorias (condominio_id, nome, grupo, cor) VALUES (1, ?, ?, ?)`);
  Object.entries(CATEGORIAS_PADRAO).forEach(([grupo, nomes]) => nomes.forEach(n => stmt.run(n, grupo, CORES_GRUPO[grupo])));
  stmt.finalize();
  console.log('✅ Banco de dados inicializado');
});

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Acesso negado' });
  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

const apenasAdmin = (req, res, next) => {
  if (!req.user.eh_admin || req.user.eh_admin === 0) return res.status(403).json({ error: 'Acesso negado' });
  next();
};

const limparTel = t => String(t || '').replace(/\D/g, '');

app.get('/manifest.json', (req, res) => res.json({ name: "Vizinha", short_name: "Vizinha", start_url: "/", display: "standalone", theme_color: "#4FB8B8" }));

app.get('/api/health', (req, res) => {
  db.get(`SELECT (SELECT COUNT(*) FROM categorias) categorias, (SELECT COUNT(*) FROM prestadores) prestadores, (SELECT COUNT(*) FROM moradores) moradores`, (err, r) => {
    if (err) return res.status(500).json({ ok: false });
    res.json({ ok: true, ...r });
  });
});

app.post('/api/login/request', (req, res) => {
  const cleanPhone = limparTel(req.body.telefone);
  if (cleanPhone.length < 10) return res.status(400).json({ error: 'Telefone inválido' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60000).toISOString();
  
  db.get(`SELECT * FROM moradores WHERE telefone = ?`, [cleanPhone], (err, row) => {
    const sql = row
      ? [`UPDATE moradores SET codigo_sms = ?, codigo_expira_em = ? WHERE telefone = ?`, [code, expires, cleanPhone]]
      : [`INSERT INTO moradores (condominio_id, telefone, codigo_sms, codigo_expira_em, status) VALUES (1, ?, ?, ?, 'pendente')`, [cleanPhone, code, expires]];
    
    db.run(sql[0], sql[1], (err2) => {
      if (err2) return res.status(500).json({ error: 'Erro no banco' });
      console.log(`[FALLBACK] Código para ${cleanPhone}: ${code}`);
      res.json({ message: 'Código enviado (simulado)' });
    });
  });
});

app.post('/api/login/verify', (req, res) => {
  const cleanPhone = limparTel(req.body.telefone);
  const codigo = String(req.body.codigo || '').trim();
  
  if (process.env.ADMIN_CODE && codigo === process.env.ADMIN_CODE) {
    const token = jwt.sign({ id: 'admin', telefone: '11999999999', eh_admin: true, condominio_id: 1 }, SECRET, { expiresIn: '7d' });
    return res.json({ token, id: 'admin', telefone: '11999999999', status: 'ativo', eh_admin: true, aceite_termos: true });
  }

  db.get(`SELECT * FROM moradores WHERE telefone = ? AND codigo_sms = ?`, [cleanPhone, codigo], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Código inválido' });
    if (new Date(row.codigo_expira_em) < new Date()) return res.status(401).json({ error: 'Expirado' });
    
    db.run(`UPDATE moradores SET codigo_sms = NULL WHERE id = ?`, [row.id]);
    const ehAdmin = Number(row.eh_admin) === 1;
    const token = jwt.sign({ id: row.id, telefone: row.telefone, eh_admin: ehAdmin, condominio_id: row.condominio_id }, SECRET, { expiresIn: '7d' });
    res.json({ token, id: row.id, telefone: row.telefone, status: row.status, eh_admin: ehAdmin, aceite_termos: !!row.aceite_termos_data });
  });
});

app.get('/api/categorias', authenticate, (req, res) => {
  db.all(`SELECT * FROM categorias WHERE condominio_id = ? ORDER BY grupo, nome`, [req.user.condominio_id], (err, rows) => res.json(err ? [] : rows));
});

app.get('/api/prestadores', authenticate, (req, res) => {
  const { busca, categoria_id } = req.query;
  let query = `SELECT p.*, c.nome as categoria_nome, c.grupo as categoria_grupo FROM prestadores p LEFT JOIN categorias c ON p.categoria_principal_id = c.id WHERE p.condominio_id = ?`;
  const params = [req.user.condominio_id];
  if (categoria_id) { query += ` AND (p.categoria_principal_id = ? OR p.outras_categorias_ids LIKE ?)`; params.push(categoria_id, `%${categoria_id}%`); }
  if (busca) { query += ` AND (p.nome LIKE ? OR p.telefone LIKE ? OR c.nome LIKE ?)`; const term = `%${busca}%`; params.push(term, term, term); }
  db.all(query + ` ORDER BY p.nome ASC`, params, (err, rows) => res.json(err ? [] : rows));
});

app.post('/api/prestadores', authenticate, (req, res) => {
  const { nome, telefone, tipo, categoria_id, diferencial } = req.body;
  const cleanPhone = limparTel(telefone);
  if (!nome || !cleanPhone || !categoria_id) return res.status(400).json({ error: 'Dados incompletos' });
  
  db.run(`INSERT INTO prestadores (condominio_id, nome, telefone, tipo, categoria_principal_id, diferencial, cadastrado_por_morador_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.condominio_id, nome, cleanPhone, tipo, categoria_id, diferencial, req.user.id], function (err) {
      if (err) return res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Telefone já existe' : 'Erro' });
      res.json({ success: true, id: this.lastID });
    });
});

app.patch('/api/prestadores/:id', authenticate, (req, res) => {
  const { nome, telefone, tipo, categoria_id, diferencial } = req.body;
  const { id: morador_id, eh_admin, condominio_id } = req.user;
  
  db.get(`SELECT * FROM prestadores WHERE id = ? AND condominio_id = ?`, [req.params.id, condominio_id], (err, p) => {
    if (err || !p) return res.status(404).json({ error: 'Não encontrado' });
    if (!eh_admin && p.cadastrado_por_morador_id !== morador_id) return res.status(403).json({ error: 'Sem permissão' });
    
    const cleanPhone = telefone ? limparTel(telefone) : p.telefone;
    db.run(`UPDATE prestadores SET nome=?, telefone=?, tipo=?, categoria_principal_id=?, diferencial=? WHERE id=?`,
      [nome, cleanPhone, tipo, categoria_id, diferencial, req.params.id], (err) => {
        if (err) return res.status(400).json({ error: 'Erro ao atualizar' });
        res.json({ success: true });
      });
  });
});

app.get('/api/prestadores/avaliacoes-resumo', authenticate, (req, res) => {
  db.all(`SELECT prestador_id, SUM(CASE WHEN tipo='indica' THEN 1 ELSE 0 END) as indica, SUM(CASE WHEN tipo='nao_indica' THEN 1 ELSE 0 END) as nao_indica FROM avaliacoes WHERE condominio_id=? GROUP BY prestador_id`, [req.user.condominio_id], (err, rows) => res.json(err ? [] : rows));
});

app.get('/api/prestadores/:id/avaliacoes-detalhe', authenticate, (req, res) => {
  db.all(`SELECT * FROM avaliacoes WHERE prestador_id = ? ORDER BY created_at DESC`, [req.params.id], (err, rows) => res.json(err ? [] : rows));
});

app.post('/api/avaliacoes', authenticate, (req, res) => {
  const { prestador_id, tipo, motivos, comentario, is_saude } = req.body;
  const finalComentario = is_saude ? null : (tipo === 'indica' ? comentario : null);
  const finalMotivos = (is_saude || tipo !== 'indica') ? null : JSON.stringify(motivos || []);
  const sql = `INSERT INTO avaliacoes (condominio_id, prestador_id, morador_telefone, tipo, motivos, comentario) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(prestador_id, morador_telefone) DO UPDATE SET tipo=excluded.tipo, motivos=excluded.motivos, comentario=excluded.comentario`;
  db.run(sql, [req.user.condominio_id, prestador_id, req.user.telefone, tipo, finalMotivos, finalComentario], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.get('/api/prestadores/:id/precos', authenticate, (req, res) => {
  db.all(`SELECT * FROM precos WHERE prestador_id = ? ORDER BY data_referencia DESC`, [req.params.id], (err, rows) => res.json(err ? [] : rows));
});

app.post('/api/prestadores/:id/precos', authenticate, (req, res) => {
  const { tipo_preco, valor, data_referencia } = req.body;
  db.run(`INSERT INTO precos (condominio_id, prestador_id, tipo_preco, valor, data_referencia, telefone) VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.condominio_id, req.params.id, tipo_preco, valor, data_referencia, req.user.telefone], function(err) { res.json(err ? {error:'Erro'} : {success:true, id:this.lastID}); });
});

app.delete('/api/precos/:id', authenticate, (req, res) => {
  const { eh_admin, telefone } = req.user;
  db.get(`SELECT * FROM precos WHERE id = ?`, [req.params.id], (err, preco) => {
    if (err || !preco) return res.status(404).json({ error: 'Não encontrado' });
    if (!eh_admin && preco.telefone !== telefone) return res.status(403).json({ error: 'Sem permissão' });
    db.run(`DELETE FROM precos WHERE id = ?`, [req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
  });
});

app.get('/api/categorias/:categoria_id/precos', authenticate, (req, res) => {
  db.all(`SELECT p.nome as prestador_nome, pr.* FROM precos pr JOIN prestadores p ON pr.prestador_id = p.id WHERE p.categoria_principal_id = ? AND pr.valor IS NOT NULL ORDER BY pr.valor ASC`, [req.params.categoria_id], (err, rows) => res.json(err ? [] : rows));
});

app.get('/api/morador/perfil', authenticate, (req, res) => {
  db.get(`SELECT nome, unidade, telefone, eh_admin FROM moradores WHERE id = ?`, [req.user.id], (err, row) => res.json(err || !row ? {error:'Não encontrado'} : row));
});

app.get('/api/morador/avaliacoes', authenticate, (req, res) => {
  db.all(`SELECT a.*, p.nome as prestador_nome FROM avaliacoes a JOIN prestadores p ON a.prestador_id = p.id WHERE a.morador_telefone = ? ORDER BY a.updated_at DESC`, [req.user.telefone], (err, rows) => res.json(err ? [] : rows));
});

app.get('/api/admin/moradores', authenticate, apenasAdmin, (req, res) => {
  db.all(`SELECT * FROM moradores WHERE condominio_id = ? ORDER BY created_at DESC`, [req.user.condominio_id], (err, rows) => res.json(err ? [] : rows));
});

app.patch('/api/admin/moradores/:id/status', authenticate, apenasAdmin, (req, res) => {
  db.run(`UPDATE moradores SET status = ? WHERE id = ?`, [req.body.status, req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.post('/api/admin/categorias', authenticate, apenasAdmin, (req, res) => {
  const { nome, grupo } = req.body;
  db.run(`INSERT INTO categorias (condominio_id, nome, grupo, cor) VALUES (?, ?, ?, '#6b7280')`, [req.user.condominio_id, nome, grupo], function(err) {
    if (err) return res.status(400).json({ error: 'Erro' });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete('/api/admin/categorias/:id', authenticate, apenasAdmin, (req, res) => {
  db.run(`DELETE FROM categorias WHERE id = ? AND condominio_id = ?`, [req.params.id, req.user.condominio_id], function(err) {
    if (err) return res.status(500).json({ error: 'Erro' });
    if (this.changes === 0) return res.status(404).json({ error: 'Não encontrada' });
    res.json({ success: true });
  });
});

app.delete('/api/admin/prestadores/:id', authenticate, apenasAdmin, (req, res) => {
  db.run(`DELETE FROM prestadores WHERE id = ? AND condominio_id = ?`, [req.params.id, req.user.condominio_id], function(err) {
    if (err) return res.status(500).json({ error: 'Erro' });
    if (this.changes === 0) return res.status(404).json({ error: 'Não encontrado' });
    db.run(`DELETE FROM precos WHERE prestador_id = ?`, [req.params.id]);
    db.run(`DELETE FROM avaliacoes WHERE prestador_id = ?`, [req.params.id]);
    res.json({ success: true });
  });
});

app.delete('/api/admin/avaliacoes/:id', authenticate, apenasAdmin, (req, res) => {
  db.run(`DELETE FROM avaliacoes WHERE id = ?`, [req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.patch('/api/admin/precos/:id', authenticate, apenasAdmin, (req, res) => {
  const { valor, tipo_preco } = req.body;
  db.run(`UPDATE precos SET valor=?, tipo_preco=? WHERE id=?`, [valor, tipo_preco, req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.post('/api/admin/limpar-testes', authenticate, apenasAdmin, (req, res) => {
  db.run(`DELETE FROM precos WHERE condominio_id = ?`, [req.user.condominio_id]);
  db.run(`DELETE FROM avaliacoes WHERE condominio_id = ?`, [req.user.condominio_id]);
  console.log("🧹 Dados de teste limpos!");
  res.json({ success: true, message: "Preços e Avaliações apagados." });
});

app.post('/api/admin/importar-prestadores', authenticate, apenasAdmin, (req, res) => {
  let lista = Array.isArray(req.body.prestadores) ? req.body.prestadores : [];
  if (lista.length === 0) return res.status(400).json({ error: 'Lista vazia' });
  const cond = req.user.condominio_id;
  const resultado = { importados: 0, ja_existiam: 0, erros: [], categorias_criadas: [] };

  db.all(`SELECT id, nome FROM categorias WHERE condominio_id = ?`, [cond], (err, cats) => {
    if (err) return res.status(500).json({ error: 'Erro' });
    const mapa = {}; cats.forEach(c => mapa[c.nome.trim().toLowerCase()] = c.id);
    const garantirCategoria = (nomeCat) => new Promise((resolve) => {
      const nome = String(nomeCat || 'Outra').trim();
      const k = nome.toLowerCase();
      if (mapa[k]) return resolve(mapa[k]);
      db.run(`INSERT OR IGNORE INTO categorias (condominio_id, nome, grupo, cor) VALUES (?, ?, 'Outros', '#6b7280')`, [cond, nome], function () {
        db.get(`SELECT id FROM categorias WHERE condominio_id = ? AND nome = ?`, [cond, nome], (e, r) => {
          if (r) { mapa[k] = r.id; resultado.categorias_criadas.push(nome); }
          resolve(r ? r.id : null);
        });
      });
    });
    
    (async () => {
      for (const p of lista) {
        if (!p.nome || limparTel(p.telefone).length < 8) { resultado.erros.push(p.nome); continue; }
        const catId = await garantirCategoria(p.categoria);
        db.run(`INSERT INTO prestadores (condominio_id, nome, telefone, tipo, categoria_principal_id, diferencial, cadastrado_por_morador_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [cond, p.nome, limparTel(p.telefone), p.tipo || 'Autônomo', catId, p.diferencial || null, req.user.id],
          (e) => { if (!e) resultado.importados++; else if (e.message.includes('UNIQUE')) resultado.ja_existiam++; });
      }
      setTimeout(() => res.json(resultado), 1000);
    })();
  });
});

app.get('/api/admin/backup', authenticate, apenasAdmin, (req, res) => {
  const tabelas = ['categorias', 'prestadores', 'avaliacoes', 'precos', 'moradores', 'mensagens'];
  const out = { gerado_em: new Date().toISOString() };
  let pend = tabelas.length;
  tabelas.forEach(t => db.all(`SELECT * FROM ${t}`, (err, rows) => {
    out[t] = err ? [] : rows.map(r => { const x = { ...r }; delete x.codigo_sms; delete x.codigo_expira_em; return x; });
    if (--pend === 0) {
      res.setHeader('Content-Disposition', `attachment; filename="vizinha-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(out);
    }
  }));
});

app.get('/api/admin/mensagens', authenticate, apenasAdmin, (req, res) => {
  db.all(`SELECT m.*, mo.nome as morador_nome, mo.unidade FROM mensagens m LEFT JOIN moradores mo ON m.morador_id = mo.id WHERE m.condominio_id = ? ORDER BY m.created_at DESC`, [req.user.condominio_id], (err, rows) => res.json(err ? [] : rows));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Servidor rodando na porta ${PORT}`));
