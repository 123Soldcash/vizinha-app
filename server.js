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

console.log('💾 Banco:', dbPath);

// Tabelas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS condominios (id INTEGER PRIMARY KEY, nome TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS moradores (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, unidade TEXT, telefone TEXT UNIQUE, codigo_sms TEXT, codigo_expira_em DATETIME, status TEXT DEFAULT 'pendente', eh_admin INTEGER DEFAULT 0, aceite_termos_data DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS categorias (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, grupo TEXT, cor TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS prestadores (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, telefone TEXT, tipo TEXT, categoria_principal_id INTEGER, diferencial TEXT, cadastrado_por_morador_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS avaliacoes (id INTEGER PRIMARY KEY, condominio_id INTEGER, prestador_id INTEGER, morador_telefone TEXT, tipo TEXT, motivos TEXT, comentario TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS precos (id INTEGER PRIMARY KEY, condominio_id INTEGER, prestador_id INTEGER, tipo_preco TEXT, valor REAL, data_referencia DATE, telefone TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY, condominio_id INTEGER, morador_id INTEGER, tipo TEXT, mensagem TEXT, lida INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  
  db.run(`INSERT OR IGNORE INTO condominios (id, nome) VALUES (1, 'Villagio Bourbon')`);
  db.run(`INSERT OR IGNORE INTO moradores (condominio_id, nome, unidade, telefone, status, eh_admin) VALUES (1, 'Administrador', '101', '11999999999', 'ativo', 1)`);
  
  console.log('✅ Banco pronto');
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
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  next();
};

const limparTel = t => String(t || '').replace(/\D/g, '');

// Health
app.get('/api/health', (req, res) => {
  db.get(`SELECT (SELECT COUNT(*) FROM categorias) as c, (SELECT COUNT(*) FROM prestadores) as p, (SELECT COUNT(*) FROM moradores) as m`, (err, r) => {
    res.json({ ok: true, ...r });
  });
});

// Login
app.post('/api/login/request', (req, res) => {
  const phone = limparTel(req.body.telefone);
  if (phone.length < 10) return res.status(400).json({ error: 'Telefone inválido' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  db.get(`SELECT * FROM moradores WHERE telefone = ?`, [phone], (err, row) => {
    if (row) {
      db.run(`UPDATE moradores SET codigo_sms = ? WHERE telefone = ?`, [code, phone]);
    } else {
      db.run(`INSERT INTO moradores (condominio_id, telefone, codigo_sms, status) VALUES (1, ?, ?, 'pendente')`, [phone, code]);
    }
    console.log(`[FALLBACK] Código para ${phone}: ${code}`);
    res.json({ message: 'Código enviado' });
  });
});

app.post('/api/login/verify', (req, res) => {
  const phone = limparTel(req.body.telefone);
  const code = req.body.codigo;
  
  if (process.env.ADMIN_CODE && code === process.env.ADMIN_CODE) {
    const token = jwt.sign({ id: 'admin', telefone: '11999999999', eh_admin: true, condominio_id: 1 }, SECRET);
    return res.json({ token, id: 'admin', telefone: '11999999999', eh_admin: true });
  }
  
  db.get(`SELECT * FROM moradores WHERE telefone = ? AND codigo_sms = ?`, [phone, code], (err, row) => {
    if (!row) return res.status(401).json({ error: 'Código inválido' });
    const token = jwt.sign({ id: row.id, telefone: row.telefone, eh_admin: !!row.eh_admin, condominio_id: row.condominio_id }, SECRET);
    res.json({ token, id: row.id, telefone: row.telefone, eh_admin: !!row.eh_admin });
  });
});

// Categorias
app.get('/api/categorias', authenticate, (req, res) => {
  db.all(`SELECT * FROM categorias WHERE condominio_id = ? ORDER BY grupo, nome`, [req.user.condominio_id], (err, rows) => res.json(err ? [] : rows));
});

// Prestadores
app.get('/api/prestadores', authenticate, (req, res) => {
  db.all(`SELECT p.*, c.nome as categoria_nome FROM prestadores p LEFT JOIN categorias c ON p.categoria_principal_id = c.id WHERE p.condominio_id = ? ORDER BY p.nome`, [req.user.condominio_id], (err, rows) => res.json(err ? [] : rows));
});

app.post('/api/prestadores', authenticate, (req, res) => {
  const { nome, telefone, tipo, categoria_id, diferencial } = req.body;
  db.run(`INSERT INTO prestadores (condominio_id, nome, telefone, tipo, categoria_principal_id, diferencial, cadastrado_por_morador_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.condominio_id, nome, limparTel(telefone), tipo, categoria_id, diferencial, req.user.id], function(err) {
      if (err) return res.status(400).json({ error: 'Erro' });
      res.json({ success: true, id: this.lastID });
    });
});

app.patch('/api/prestadores/:id', authenticate, (req, res) => {
  const { nome, telefone, tipo, categoria_id, diferencial } = req.body;
  db.run(`UPDATE prestadores SET nome=?, telefone=?, tipo=?, categoria_principal_id=?, diferencial=? WHERE id=?`,
    [nome, limparTel(telefone), tipo, categoria_id, diferencial, req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.delete('/api/admin/prestadores/:id', authenticate, apenasAdmin, (req, res) => {
  db.run(`DELETE FROM prestadores WHERE id=?`, [req.params.id]);
  db.run(`DELETE FROM precos WHERE prestador_id=?`, [req.params.id]);
  db.run(`DELETE FROM avaliacoes WHERE prestador_id=?`, [req.params.id]);
  res.json({ success: true });
});

// Avaliações
app.get('/api/prestadores/avaliacoes-resumo', authenticate, (req, res) => {
  db.all(`SELECT prestador_id, SUM(CASE WHEN tipo='indica' THEN 1 ELSE 0 END) as indica, SUM(CASE WHEN tipo='nao_indica' THEN 1 ELSE 0 END) as nao_indica FROM avaliacoes GROUP BY prestador_id`, (err, rows) => res.json(err ? [] : rows));
});

app.get('/api/prestadores/:id/avaliacoes-detalhe', authenticate, (req, res) => {
  db.all(`SELECT * FROM avaliacoes WHERE prestador_id = ? ORDER BY created_at DESC`, [req.params.id], (err, rows) => res.json(err ? [] : rows));
});

app.post('/api/avaliacoes', authenticate, (req, res) => {
  const { prestador_id, tipo, motivos, comentario } = req.body;
  db.run(`INSERT INTO avaliacoes (condominio_id, prestador_id, morador_telefone, tipo, motivos, comentario) VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.condominio_id, prestador_id, req.user.telefone, tipo, JSON.stringify(motivos||[]), comentario], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.delete('/api/admin/avaliacoes/:id', authenticate, apenasAdmin, (req, res) => {
  db.run(`DELETE FROM avaliacoes WHERE id=?`, [req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

// Preços
app.get('/api/prestadores/:id/precos', authenticate, (req, res) => {
  db.all(`SELECT * FROM precos WHERE prestador_id=? ORDER BY data_referencia DESC`, [req.params.id], (err, rows) => res.json(err ? [] : rows));
});

app.post('/api/prestadores/:id/precos', authenticate, (req, res) => {
  const { tipo_preco, valor, data_referencia } = req.body;
  db.run(`INSERT INTO precos (condominio_id, prestador_id, tipo_preco, valor, data_referencia, telefone) VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.condominio_id, req.params.id, tipo_preco, valor, data_referencia, req.user.telefone], function(err) { res.json(err ? {error:'Erro'} : {success:true}); });
});

app.delete('/api/precos/:id', authenticate, (req, res) => {
  db.run(`DELETE FROM precos WHERE id=?`, [req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.patch('/api/admin/precos/:id', authenticate, apenasAdmin, (req, res) => {
  const { valor, tipo_preco } = req.body;
  db.run(`UPDATE precos SET valor=?, tipo_preco=? WHERE id=?`, [valor, tipo_preco, req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.get('/api/categorias/:id/precos', authenticate, (req, res) => {
  db.all(`SELECT p.nome as prestador_nome, pr.* FROM precos pr JOIN prestadores p ON pr.prestador_id = p.id WHERE p.categoria_principal_id=? AND pr.valor IS NOT NULL`, [req.params.id], (err, rows) => res.json(err ? [] : rows));
});

// Admin
app.get('/api/admin/moradores', authenticate, apenasAdmin, (req, res) => {
  db.all(`SELECT * FROM moradores ORDER BY created_at DESC`, (err, rows) => res.json(err ? [] : rows));
});

app.patch('/api/admin/moradores/:id/status', authenticate, apenasAdmin, (req, res) => {
  db.run(`UPDATE moradores SET status=? WHERE id=?`, [req.body.status, req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.post('/api/admin/categorias', authenticate, apenasAdmin, (req, res) => {
  const { nome, grupo } = req.body;
  db.run(`INSERT INTO categorias (condominio_id, nome, grupo, cor) VALUES (?, ?, ?, '#6b7280')`, [req.user.condominio_id, nome, grupo], function(err) { res.json(err ? {error:'Erro'} : {success:true, id:this.lastID}); });
});

app.delete('/api/admin/categorias/:id', authenticate, apenasAdmin, (req, res) => {
  db.run(`DELETE FROM categorias WHERE id=?`, [req.params.id], (err) => res.json(err ? {error:'Erro'} : {success:true}));
});

app.post('/api/admin/limpar-testes', authenticate, apenasAdmin, (req, res) => {
  db.run(`DELETE FROM precos`);
  db.run(`DELETE FROM avaliacoes`);
  console.log('🧹 Dados limpos');
  res.json({ success: true });
});

app.post('/api/admin/importar-prestadores', authenticate, apenasAdmin, (req, res) => {
  const lista = req.body.prestadores || [];
  let importados = 0;
  let erros = 0;
  let done = 0;
  
  if (lista.length === 0) return res.status(400).json({ error: 'Lista vazia' });
  
  lista.forEach(p => {
    if (!p.nome || limparTel(p.telefone).length < 8) { erros++; done++; return; }
    db.run(`INSERT INTO prestadores (condominio_id, nome, telefone, tipo, categoria_principal_id, diferencial, cadastrado_por_morador_id) VALUES (1, ?, ?, ?, (SELECT id FROM categorias WHERE nome=? LIMIT 1), ?, ?)`,
      [p.nome, limparTel(p.telefone), p.tipo || 'Autônomo', p.categoria, p.diferencial || '', req.user.id],
      (err) => { if (!err) importados++; else erros++; done++; if (done === lista.length) res.json({ importados, erros }); });
  });
});

app.get('/api/admin/backup', authenticate, apenasAdmin, (req, res) => {
  const out = {};
  let pend = 6;
  ['categorias','prestadores','avaliacoes','precos','moradores','mensagens'].forEach(t => {
    db.all(`SELECT * FROM ${t}`, (err, rows) => { out[t] = rows || []; if (--pend === 0) res.json(out); });
  });
});

// Perfil
app.get('/api/morador/perfil', authenticate, (req, res) => {
  db.get(`SELECT nome, unidade, telefone, eh_admin FROM moradores WHERE id=?`, [req.user.id], (err, row) => res.json(err || !row ? {error:'Não encontrado'} : row));
});

app.get('/api/morador/avaliacoes', authenticate, (req, res) => {
  db.all(`SELECT a.*, p.nome as prestador_nome FROM avaliacoes a JOIN prestadores p ON a.prestador_id = p.id WHERE a.morador_telefone=?`, [req.user.telefone], (err, rows) => res.json(err ? [] : rows));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Servidor rodando na porta ${PORT}`));
