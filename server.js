const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./vizinha.db');
const SECRET = 'sua_chave_secreta_muito_forte_aqui';

if (process.argv.includes('--init-db')) {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS condominios (id INTEGER PRIMARY KEY, nome TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS moradores (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, unidade TEXT, telefone TEXT UNIQUE, codigo_sms TEXT, codigo_expira_em DATETIME, status TEXT DEFAULT 'pendente', eh_admin BOOLEAN DEFAULT 0, aceite_termos_data DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS categorias (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, grupo TEXT, cor TEXT, em_uso BOOLEAN DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS prestadores (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, telefone TEXT UNIQUE, tipo TEXT, categoria_principal_id INTEGER, outras_categorias_ids TEXT, diferencial TEXT, endereco TEXT, email TEXT, blacklisted BOOLEAN DEFAULT 0, cadastrado_por_morador_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS avaliacoes (id INTEGER PRIMARY KEY, condominio_id INTEGER, prestador_id INTEGER, morador_telefone TEXT, tipo TEXT, motivos TEXT, comentario TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(prestador_id, morador_telefone))`);
    db.run(`CREATE TABLE IF NOT EXISTS precos (id INTEGER PRIMARY KEY, condominio_id INTEGER, prestador_id INTEGER, tipo_preco TEXT, valor REAL, data_referencia DATE, inclui_transporte BOOLEAN DEFAULT 0, inclui_produtos BOOLEAN DEFAULT 0, telefone TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY, condominio_id INTEGER, morador_id INTEGER, tipo TEXT, mensagem TEXT, lida BOOLEAN DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`INSERT OR IGNORE INTO condominios (id, nome) VALUES (1, 'Villagio Bourbon')`);
    db.run(`INSERT OR IGNORE INTO moradores (condominio_id, nome, unidade, telefone, status, eh_admin, aceite_termos_data) VALUES (1, 'Administrador', '101', '11999999999', 'ativo', 1, CURRENT_TIMESTAMP)`);
    console.log('Banco de dados inicializado com sucesso.');
  });
  process.exit(0);
}

db.run(`ALTER TABLE precos ADD COLUMN telefone TEXT`, (err) => {
  if (err && !err.message.includes('duplicate column')) console.log('Coluna telefone já existe.');
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

app.post('/api/login/request', (req, res) => {
  const { telefone } = req.body;
  const cleanPhone = telefone.replace(/\D/g, '');
  if (cleanPhone.length < 10 || cleanPhone.length > 11) return res.status(400).json({ error: 'Telefone inválido' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60000).toISOString();
  db.get(`SELECT * FROM moradores WHERE telefone = ?`, [cleanPhone], (err, row) => {
    if (err) return res.status(500).json({ error: 'Erro no banco' });
    if (row) {
      db.run(`UPDATE moradores SET codigo_sms = ?, codigo_expira_em = ? WHERE telefone = ?`, [code, expires, cleanPhone]);
    } else {
      db.run(`INSERT INTO moradores (condominio_id, telefone, codigo_sms, codigo_expira_em, status) VALUES (1, ?, ?, ?, 'pendente')`, [cleanPhone, code, expires]);
    }
    console.log(`[SMS SIMULADO] Código para ${cleanPhone}: ${code}`);
    res.json({ message: 'Código enviado' });
  });
});

app.post('/api/login/verify', (req, res) => {
  const { telefone, codigo } = req.body;
  const cleanPhone = telefone.replace(/\D/g, '');
  db.get(`SELECT * FROM moradores WHERE telefone = ? AND codigo_sms = ?`, [cleanPhone, codigo], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Código inválido' });
    if (new Date(row.codigo_expira_em) < new Date()) return res.status(401).json({ error: 'Código expirado' });
    if (row.status === 'inativo') return res.status(403).json({ error: 'Cadastro inativo' });
    const token = jwt.sign({ id: row.id, telefone: row.telefone, eh_admin: row.eh_admin, condominio_id: row.condominio_id }, SECRET, { expiresIn: '7d' });
    res.json({ token, id: row.id, telefone: row.telefone, status: row.status, eh_admin: row.eh_admin, aceite_termos: !!row.aceite_termos_data });
  });
});

app.post('/api/termos/aceite', authenticate, (req, res) => {
  db.run(`UPDATE moradores SET aceite_termos_data = CURRENT_TIMESTAMP WHERE id = ?`, [req.user.id], (err) => {
    res.json({ success: true });
  });
});

app.get('/api/prestadores', authenticate, (req, res) => {
  const { busca, categoria_id } = req.query;
  let query = `SELECT p.*, c.nome as categoria_nome, c.grupo as categoria_grupo FROM prestadores p LEFT JOIN categorias c ON p.categoria_principal_id = c.id WHERE p.condominio_id = ?`;
  const params = [req.user.condominio_id];
  if (categoria_id) { query += ` AND (p.categoria_principal_id = ? OR p.outras_categorias_ids LIKE ?)`; params.push(categoria_id, `%${categoria_id}%`); }
  if (busca) { query += ` AND (p.nome LIKE ? OR p.telefone LIKE ? OR c.nome LIKE ?)`; const term = `%${busca}%`; params.push(term, term, term); }
  query += ` ORDER BY p.blacklisted ASC, p.nome ASC`;
  db.all(query, params, (err, rows) => { if (err) return res.status(500).json({ error: 'Erro ao buscar' }); res.json(rows); });
});

app.post('/api/avaliacoes', authenticate, (req, res) => {
  const { prestador_id, tipo, motivos, comentario, is_saude } = req.body;
  const { telefone, condominio_id } = req.user;
  const finalComentario = is_saude ? null : (tipo === 'indica' ? comentario : null);
  const finalMotivos = (is_saude || tipo !== 'indica') ? null : JSON.stringify(motivos || []);
  const sql = `INSERT INTO avaliacoes (condominio_id, prestador_id, morador_telefone, tipo, motivos, comentario, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(prestador_id, morador_telefone) DO UPDATE SET tipo=excluded.tipo, motivos=excluded.motivos, comentario=excluded.comentario, updated_at=CURRENT_TIMESTAMP`;
  db.run(sql, [condominio_id, prestador_id, telefone, tipo, finalMotivos, finalComentario], function(err) { if (err) return res.status(500).json({ error: 'Erro ao salvar' }); res.json({ success: true }); });
});

app.get('/api/avaliacoes/minha/:prestador_id', authenticate, (req, res) => {
  db.get(`SELECT * FROM avaliacoes WHERE prestador_id = ? AND morador_telefone = ?`, [req.params.prestador_id, req.user.telefone], (err, row) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(row || null); });
});

app.get('/api/prestadores/avaliacoes-resumo', authenticate, (req, res) => {
  db.all(`SELECT prestador_id, SUM(CASE WHEN tipo = 'indica' THEN 1 ELSE 0 END) as indica, SUM(CASE WHEN tipo = 'nao_indica' THEN 1 ELSE 0 END) as nao_indica FROM avaliacoes WHERE condominio_id = ? GROUP BY prestador_id`, [req.user.condominio_id], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(rows); });
});

app.get('/api/prestadores/:id/avaliacoes', authenticate, (req, res) => {
  db.all(`SELECT tipo, comentario FROM avaliacoes WHERE prestador_id = ?`, [req.params.id], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); const indica = rows.filter(r => r.tipo === 'indica').length; const nao_indica = rows.filter(r => r.tipo === 'nao_indica').length; const comentarios = rows.filter(r => r.tipo === 'indica' && r.comentario).map(r => r.comentario); res.json({ indica, nao_indica, comentarios }); });
});

app.post('/api/prestadores', authenticate, (req, res) => {
  const { nome, telefone, tipo, categoria_id, diferencial, endereco, email } = req.body;
  const { condominio_id, id: morador_id } = req.user;
  const cleanPhone = telefone.replace(/\D/g, '');
  const sql = `INSERT INTO prestadores (condominio_id, nome, telefone, tipo, categoria_principal_id, diferencial, endereco, email, cadastrado_por_morador_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [condominio_id, nome, cleanPhone, tipo, categoria_id, diferencial, endereco, email, morador_id], function(err) { if (err) { if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Telefone já cadastrado' }); return res.status(500).json({ error: 'Erro' }); } res.json({ success: true, id: this.lastID }); });
});

app.get('/api/categorias', authenticate, (req, res) => {
  db.all(`SELECT * FROM categorias WHERE condominio_id = ? ORDER BY grupo, nome`, [req.user.condominio_id], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(rows); });
});

app.get('/api/admin/moradores', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.all(`SELECT id, nome, unidade, telefone, status, eh_admin, created_at FROM moradores WHERE condominio_id = ? ORDER BY created_at DESC`, [req.user.condominio_id], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(rows); });
});

app.patch('/api/admin/moradores/:id/status', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.run(`UPDATE moradores SET status = ? WHERE id = ? AND condominio_id = ?`, [req.body.status, req.params.id, req.user.condominio_id], (err) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true }); });
});

app.patch('/api/admin/prestadores/:id/blacklist', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.run(`UPDATE prestadores SET blacklisted = ? WHERE id = ? AND condominio_id = ?`, [req.body.blacklisted ? 1 : 0, req.params.id, req.user.condominio_id], (err) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true }); });
});

app.delete('/api/admin/prestadores/:id', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.run(`DELETE FROM prestadores WHERE id = ? AND condominio_id = ?`, [req.params.id, req.user.condominio_id], (err) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true }); });
});

app.get('/api/admin/categorias', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.all(`SELECT * FROM categorias WHERE condominio_id = ? ORDER BY grupo, nome`, [req.user.condominio_id], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(rows); });
});

app.post('/api/admin/categorias', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.run(`INSERT INTO categorias (condominio_id, nome, grupo, cor) VALUES (?, ?, ?, ?)`, [req.user.condominio_id, req.body.nome, req.body.grupo, req.body.cor || '#6B7280'], function(err) { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true, id: this.lastID }); });
});

app.get('/api/admin/mensagens', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.all(`SELECT m.*, mo.nome as morador_nome, mo.unidade FROM mensagens m LEFT JOIN moradores mo ON m.morador_id = mo.id WHERE m.condominio_id = ? ORDER BY m.created_at DESC`, [req.user.condominio_id], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(rows); });
});

app.patch('/api/admin/mensagens/:id/lida', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.run(`UPDATE mensagens SET lida = 1 WHERE id = ? AND condominio_id = ?`, [req.params.id, req.user.condominio_id], (err) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true }); });
});

app.post('/api/mensagens', authenticate, (req, res) => {
  db.run(`INSERT INTO mensagens (condominio_id, morador_id, tipo, mensagem) VALUES (?, ?, ?, ?)`, [req.user.condominio_id, req.user.id, req.body.tipo, req.body.mensagem], function(err) { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true }); });
});

app.get('/api/morador/perfil', authenticate, (req, res) => {
  db.get(`SELECT nome, unidade, telefone, eh_admin FROM moradores WHERE id = ?`, [req.user.id], (err, row) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(row); });
});

app.get('/api/prestadores/:id/precos', authenticate, (req, res) => {
  db.all(`SELECT * FROM precos WHERE prestador_id = ? ORDER BY data_referencia DESC`, [req.params.id], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(rows); });
});

app.post('/api/prestadores/:id/precos', authenticate, (req, res) => {
  const { tipo_preco, valor, data_referencia } = req.body;
  const { condominio_id, telefone } = req.user;
  const sql = `INSERT INTO precos (condominio_id, prestador_id, tipo_preco, valor, data_referencia, telefone) VALUES (?, ?, ?, ?, ?, ?)`;
  db.run(sql, [condominio_id, req.params.id, tipo_preco, valor || null, data_referencia, telefone], function(err) { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true, id: this.lastID }); });
});

app.patch('/api/precos/:id', authenticate, (req, res) => {
  const { valor, tipo_preco } = req.body;
  const { eh_admin, telefone } = req.user;
  db.get(`SELECT * FROM precos WHERE id = ?`, [req.params.id], (err, preco) => {
    if (err || !preco) return res.status(404).json({ error: 'Preço não encontrado' });
    if (!eh_admin && preco.telefone !== telefone) return res.status(403).json({ error: 'Sem permissão' });
    db.run(`UPDATE precos SET valor = ?, tipo_preco = ? WHERE id = ?`, [valor, tipo_preco, req.params.id], (err) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true }); });
  });
});

app.delete('/api/precos/:id', authenticate, (req, res) => {
  const { eh_admin, telefone } = req.user;
  db.get(`SELECT * FROM precos WHERE id = ?`, [req.params.id], (err, preco) => {
    if (err || !preco) return res.status(404).json({ error: 'Preço não encontrado' });
    if (!eh_admin && preco.telefone !== telefone) return res.status(403).json({ error: 'Sem permissão' });
    db.run(`DELETE FROM precos WHERE id = ?`, [req.params.id], (err) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true }); });
  });
});

app.get('/api/categorias/:categoria_id/precos', authenticate, (req, res) => {
  db.all(`SELECT p.nome as prestador_nome, pr.tipo_preco, pr.valor, pr.data_referencia FROM precos pr JOIN prestadores p ON pr.prestador_id = p.id WHERE p.categoria_principal_id = ? AND pr.valor IS NOT NULL ORDER BY pr.valor ASC`, [req.params.categoria_id], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(rows); });
});

app.get('/api/morador/avaliacoes', authenticate, (req, res) => {
  db.all(`SELECT a.*, p.nome as prestador_nome, p.telefone as prestador_telefone FROM avaliacoes a JOIN prestadores p ON a.prestador_id = p.id WHERE a.morador_telefone = ? ORDER BY a.updated_at DESC`, [req.user.telefone], (err, rows) => { if (err) return res.status(500).json({ error: 'Erro' }); res.json(rows); });
});

app.delete('/api/morador/conta', authenticate, (req, res) => {
  db.run(`UPDATE moradores SET nome = 'Conta Excluída', unidade = '---', status = 'inativo', aceite_termos_data = NULL WHERE id = ?`, [req.user.id], (err) => { res.json({ success: true }); });
});

app.patch('/api/prestadores/:id', authenticate, (req, res) => {
  const { nome, telefone, tipo, categoria_id, diferencial } = req.body;
  const { id: morador_id, eh_admin, condominio_id } = req.user;
  db.get(`SELECT * FROM prestadores WHERE id = ? AND condominio_id = ?`, [req.params.id, condominio_id], (err, prestador) => {
    if (err || !prestador) return res.status(404).json({ error: 'Prestador não encontrado' });
    if (!eh_admin && prestador.cadastrado_por_morador_id !== morador_id) return res.status(403).json({ error: 'Sem permissão' });
    const cleanPhone = telefone ? telefone.replace(/\D/g, '') : prestador.telefone;
    db.run(`UPDATE prestadores SET nome = ?, telefone = ?, tipo = ?, categoria_principal_id = ?, diferencial = ? WHERE id = ?`, [nome || prestador.nome, cleanPhone, tipo || prestador.tipo, categoria_id || prestador.categoria_principal_id, diferencial !== undefined ? diferencial : prestador.diferencial, req.params.id], function(err) { if (err) return res.status(500).json({ error: 'Erro' }); res.json({ success: true }); });
  });
});

// ✅ ROTA TEMPORÁRIA: Promover usuário a Admin
app.post('/api/admin/promover', authenticate, (req, res) => {
  db.run(`UPDATE moradores SET eh_admin = 1, status = 'ativo', nome = 'Administrador', unidade = '101' WHERE id = ?`, [req.user.id], function(err) {
    if (err) return res.status(500).json({ error: 'Erro ao promover' });
    res.json({ sucesso: true, message: 'Você agora é Administrador!' });
  });
});

// ✅ ROTA DEFINITIVA: Organizar categorias e prestadores
// Use UMA VEZ e depois REMOVA!
app.get('/api/organizar-tudo', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Apenas admin' });
  
  const resultados = { categorias_criadas: 0, prestadores_movidos: 0, detalhes: [] };
  let etapasConcluidas = 0;
  const totalEtapas = 3;
  
  const finalizar = () => {
    etapasConcluidas++;
    if (etapasConcluidas === totalEtapas) {
      res.json(resultados);
    }
  };
  
  // ETAPA 1: Criar categorias faltantes
  const novasCategorias = [
    { nome: 'Vidros', grupo: 'Assistência Técnica e Instalações', cor: '#7c3aed' },
    { nome: 'Porta e Janelas', grupo: 'Assistência Técnica e Instalações', cor: '#7c3aed' },
    { nome: 'Tela de Proteção', grupo: 'Assistência Técnica e Instalações', cor: '#7c3aed' },
    { nome: 'Cortinas', grupo: 'Casa e Limpeza', cor: '#4FB8B8' },
    { nome: 'Doces e Bolos', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Reforma de Móveis e Estofados', grupo: 'Obras e Reformas', cor: '#d97706' },
    { nome: 'Professor de Tênis', grupo: 'Educação e Idiomas', cor: '#8b5cf6' },
    { nome: 'Manutenção de Bicicletas', grupo: 'Assistência Técnica e Instalações', cor: '#7c3aed' },
    { nome: 'Artesanato e Personalizados', grupo: 'Outros', cor: '#6b7280' },
    { nome: 'Comida Caseira e Marmitas', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Mudanças e Fretes', grupo: 'Família e Área Externa', cor: '#475569' },
    { nome: 'Pães', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Padaria', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Restaurante', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Pizzaria', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Lanchonete', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Marmitaria', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Açaí e Sorveteria', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Adega e Bebidas', grupo: 'Alimentação e Entregas', cor: '#059669' },
    { nome: 'Médico', grupo: 'Saúde e Home Care', cor: '#dc2626' },
    { nome: 'Dentista', grupo: 'Saúde e Home Care', cor: '#dc2626' },
    { nome: 'Psicólogo', grupo: 'Saúde e Home Care', cor: '#dc2626' },
    { nome: 'Fonoaudióloga', grupo: 'Saúde e Home Care', cor: '#dc2626' },
    { nome: 'Corretor de Imóveis', grupo: 'Família e Área Externa', cor: '#475569' },
    { nome: 'Reformas em Geral', grupo: 'Obras e Reformas', cor: '#d97706' },
    { nome: 'Calhas', grupo: 'Obras e Reformas', cor: '#d97706' },
    { nome: 'Pet Shop', grupo: 'Pets e Animais', cor: '#10b981' },
    { nome: 'Cuidador de Pet', grupo: 'Pets e Animais', cor: '#10b981' },
    { nome: 'Professor de Inglês', grupo: 'Educação e Idiomas', cor: '#8b5cf6' },
    { nome: 'Espanhol', grupo: 'Educação e Idiomas', cor: '#8b5cf6' }
  ];
  
  let catsCriadas = 0;
  novasCategorias.forEach(cat => {
    db.run(`INSERT OR IGNORE INTO categorias (condominio_id, nome, grupo, cor) VALUES (1, ?, ?, ?)`, [cat.nome, cat.grupo, cat.cor], function(err) {
      if (!err && this.changes > 0) {
        resultados.categorias_criadas++;
        resultados.detalhes.push(`📁 Categoria criada: ${cat.nome}`);
      }
      catsCriadas++;
      if (catsCriadas === novasCategorias.length) finalizar();
    });
  });
  
  // ETAPA 2: Buscar todas as categorias e prestadores
  db.all(`SELECT * FROM categorias WHERE condominio_id = 1`, [], (err, categorias) => {
    if (err) { finalizar(); return; }
    
    db.all(`SELECT * FROM prestadores WHERE condominio_id = 1`, [], (err, prestadores) => {
      if (err) { finalizar(); return; }
      
      // ETAPA 3: Mover prestadores baseado em palavras-chave
      const regras = [
        { palavra: 'mudanc', categoria: 'Mudanças e Fretes' },
        { palavra: 'porta', categoria: 'Porta e Janelas' },
        { palavra: 'janela', categoria: 'Porta e Janelas' },
        { palavra: 'imóvel', categoria: 'Corretor de Imóveis' },
        { palavra: 'imovel', categoria: 'Corretor de Imóveis' },
        { palavra: 'tela', categoria: 'Tela de Proteção' },
        { palavra: 'pressurizador', categoria: 'Assistência Técnica e Instalações' },
        { palavra: 'cortina', categoria: 'Cortinas' },
        { palavra: 'colcha', categoria: 'Cortinas' },
        { palavra: 'almofad', categoria: 'Cortinas' },
        { palavra: 'docinh', categoria: 'Doces e Bolos' },
        { palavra: 'brigadeir', categoria: 'Doces e Bolos' },
        { palavra: 'doce amor', categoria: 'Doces e Bolos' },
        { palavra: 'vidro', categoria: 'Vidros' },
        { palavra: 'k3', categoria: 'Vidros' },
        { palavra: 'sofá', categoria: 'Reforma de Móveis e Estofados' },
        { palavra: 'sofa', categoria: 'Reforma de Móveis e Estofados' },
        { palavra: 'tênis', categoria: 'Professor de Tênis' },
        { palavra: 'tenis', categoria: 'Professor de Tênis' },
        { palavra: 'bike', categoria: 'Manutenção de Bicicletas' },
        { palavra: 'bicicleta', categoria: 'Manutenção de Bicicletas' },
        { palavra: 'personalizado', categoria: 'Artesanato e Personalizados' },
        { palavra: 'copo', categoria: 'Artesanato e Personalizados' },
        { palavra: 'feijão', categoria: 'Comida Caseira e Marmitas' },
        { palavra: 'feijao', categoria: 'Comida Caseira e Marmitas' },
        { palavra: 'grill', categoria: 'Comida Caseira e Marmitas' },
        { palavra: 'churrasqueir', categoria: 'Comida Caseira e Marmitas' },
        { palavra: 'pão', categoria: 'Pães' },
        { palavra: 'pao', categoria: 'Pães' },
        { palavra: 'padaria', categoria: 'Padaria' },
        { palavra: 'restaurante', categoria: 'Restaurante' },
        { palavra: 'pizzaria', categoria: 'Pizzaria' },
        { palavra: 'lanchonete', categoria: 'Lanchonete' },
        { palavra: 'marmita', categoria: 'Marmitaria' },
        { palavra: 'açaí', categoria: 'Açaí e Sorveteria' },
        { palavra: 'acai', categoria: 'Açaí e Sorveteria' },
        { palavra: 'sorvete', categoria: 'Açaí e Sorveteria' },
        { palavra: 'adega', categoria: 'Adega e Bebidas' },
        { palavra: 'bebida', categoria: 'Adega e Bebidas' }
      ];
      
      let movidos = 0;
      let processados = 0;
      
      prestadores.forEach(p => {
        if (p.categoria_principal_id === 2) { // Apenas "Outra"
          const nomeLower = p.nome.toLowerCase();
          let movido = false;
          
          for (const regra of regras) {
            if (nomeLower.includes(regra.palavra)) {
              const catDestino = categorias.find(c => c.nome === regra.categoria);
              if (catDestino && p.categoria_principal_id !== catDestino.id) {
                db.run(`UPDATE prestadores SET categoria_principal_id = ? WHERE id = ?`, [catDestino.id, p.id], function(err) {
                  if (!err && this.changes > 0) {
                    resultados.prestadores_movidos++;
                    resultados.detalhes.push(`✅ ${p.nome} → ${regra.categoria}`);
                  }
                  processados++;
                  if (processados === prestadores.filter(x => x.categoria_principal_id === 2).length) finalizar();
                });
              } else {
                processados++;
                if (processados === prestadores.filter(x => x.categoria_principal_id === 2).length) finalizar();
              }
              movido = true;
              break;
            }
          }
          
          if (!movido) {
            processados++;
            if (processados === prestadores.filter(x => x.categoria_principal_id === 2).length) finalizar();
          }
        }
      });
      
      // Se não há prestadores em "Outra", finaliza imediatamente
      const outrosCount = prestadores.filter(x => x.categoria_principal_id === 2).length;
      if (outrosCount === 0) finalizar();
    });
  });
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));