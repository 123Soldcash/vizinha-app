const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
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

// Inicialização do Banco (rodar com node server.js --init-db)
if (process.argv.includes('--init-db')) {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS condominios (id INTEGER PRIMARY KEY, nome TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS moradores (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, unidade TEXT, telefone TEXT UNIQUE, codigo_sms TEXT, codigo_expira_em DATETIME, status TEXT DEFAULT 'pendente', eh_admin BOOLEAN DEFAULT 0, aceite_termos_data DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS categorias (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, grupo TEXT, cor TEXT, em_uso BOOLEAN DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS prestadores (id INTEGER PRIMARY KEY, condominio_id INTEGER, nome TEXT, telefone TEXT UNIQUE, tipo TEXT, categoria_principal_id INTEGER, outras_categorias_ids TEXT, diferencial TEXT, endereco TEXT, email TEXT, blacklisted BOOLEAN DEFAULT 0, cadastrado_por_morador_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS avaliacoes (id INTEGER PRIMARY KEY, condominio_id INTEGER, prestador_id INTEGER, morador_telefone TEXT, tipo TEXT, motivos TEXT, comentario TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(prestador_id, morador_telefone))`);
    db.run(`CREATE TABLE IF NOT EXISTS precos (id INTEGER PRIMARY KEY, condominio_id INTEGER, prestador_id INTEGER, tipo_preco TEXT, valor REAL, data_referencia DATE, inclui_transporte BOOLEAN DEFAULT 0, inclui_produtos BOOLEAN DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY, condominio_id INTEGER, morador_id INTEGER, tipo TEXT, mensagem TEXT, lida BOOLEAN DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    
    // Dados iniciais
    db.run(`INSERT OR IGNORE INTO condominios (id, nome) VALUES (1, 'Villagio Bourbon')`);
    db.run(`INSERT OR IGNORE INTO moradores (condominio_id, nome, unidade, telefone, status, eh_admin, aceite_termos_data) VALUES (1, 'Administrador Teste', '101', '11999999999', 'ativo', 1, CURRENT_TIMESTAMP)`);
    console.log('Banco de dados inicializado com sucesso.');
  });
  process.exit(0);
}

// Middleware de Autenticação
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Acesso negado' });
  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

// --- ROTAS ---

// 1. Login: Solicitar Código
app.post('/api/login/request', (req, res) => {
  const { telefone } = req.body;
  const cleanPhone = telefone.replace(/\D/g, '');
  if (cleanPhone.length < 10 || cleanPhone.length > 11) return res.status(400).json({ error: 'Telefone inválido' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60000).toISOString(); // 10 minutos

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

// 2. Login: Verificar Código (CORRIGIDO: agora retorna id e telefone)
app.post('/api/login/verify', (req, res) => {
  const { telefone, codigo } = req.body;
  const cleanPhone = telefone.replace(/\D/g, '');
  
  db.get(`SELECT * FROM moradores WHERE telefone = ? AND codigo_sms = ?`, [cleanPhone, codigo], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Código inválido' });
    if (new Date(row.codigo_expira_em) < new Date()) return res.status(401).json({ error: 'Código expirado' });
    if (row.status === 'inativo') return res.status(403).json({ error: 'Cadastro inativo' });
    
    const token = jwt.sign({ id: row.id, telefone: row.telefone, eh_admin: row.eh_admin, condominio_id: row.condominio_id }, SECRET, { expiresIn: '7d' });
    
    res.json({ 
      token, 
      id: row.id, 
      telefone: row.telefone, 
      status: row.status, 
      eh_admin: row.eh_admin, 
      aceite_termos: !!row.aceite_termos_data 
    });
  });
});

// 3. Aceite de Termos
app.post('/api/termos/aceite', authenticate, (req, res) => {
  db.run(`UPDATE moradores SET aceite_termos_data = CURRENT_TIMESTAMP WHERE id = ?`, [req.user.id], (err) => {
    res.json({ success: true });
  });
});

// 4. Listar Prestadores
app.get('/api/prestadores', authenticate, (req, res) => {
  const { busca, categoria_id } = req.query;
  let query = `SELECT p.*, c.nome as categoria_nome FROM prestadores p LEFT JOIN categorias c ON p.categoria_principal_id = c.id WHERE p.condominio_id = ?`;
  const params = [req.user.condominio_id];

  if (categoria_id) {
    query += ` AND (p.categoria_principal_id = ? OR p.outras_categorias_ids LIKE ?)`;
    params.push(categoria_id, `%${categoria_id}%`);
  }
  if (busca) {
    query += ` AND (p.nome LIKE ? OR p.telefone LIKE ? OR c.nome LIKE ?)`;
    const term = `%${busca}%`;
    params.push(term, term, term);
  }
  query += ` ORDER BY p.blacklisted ASC, p.nome ASC`; 

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 5. Salvar Avaliação
app.post('/api/avaliacoes', authenticate, (req, res) => {
  const { prestador_id, tipo, motivos, comentario, is_saude } = req.body;
  const { telefone, condominio_id } = req.user;

  const finalComentario = is_saude ? null : (tipo === 'indica' ? comentario : null);
  const finalMotivos = tipo === 'indica' ? JSON.stringify(motivos || []) : null;

  const sql = `INSERT INTO avaliacoes (condominio_id, prestador_id, morador_telefone, tipo, motivos, comentario, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(prestador_id, morador_telefone) 
               DO UPDATE SET tipo=excluded.tipo, motivos=excluded.motivos, comentario=excluded.comentario, updated_at=CURRENT_TIMESTAMP`;
  
  db.run(sql, [condominio_id, prestador_id, telefone, tipo, finalMotivos, finalComentario], function(err) {
    if (err) return res.status(500).json({ error: 'Erro ao salvar avaliação' });
    res.json({ success: true });
  });
});

// 5.5. Buscar avaliação atual do morador
app.get('/api/avaliacoes/minha/:prestador_id', authenticate, (req, res) => {
  const prestador_id = req.params.prestador_id;
  const { telefone } = req.user;
  
  db.get(`SELECT * FROM avaliacoes WHERE prestador_id = ? AND morador_telefone = ?`, 
    [prestador_id, telefone], (err, row) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(row || null);
  });
});

// 5.9. Resumo de avaliações de TODOS os prestadores
app.get('/api/prestadores/avaliacoes-resumo', authenticate, (req, res) => {
  db.all(`
    SELECT prestador_id, 
           SUM(CASE WHEN tipo = 'indica' THEN 1 ELSE 0 END) as indica,
           SUM(CASE WHEN tipo = 'nao_indica' THEN 1 ELSE 0 END) as nao_indica
    FROM avaliacoes 
    WHERE condominio_id = ?
    GROUP BY prestador_id
  `, [req.user.condominio_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 6. Resumo de Avaliações
app.get('/api/prestadores/:id/avaliacoes', authenticate, (req, res) => {
  const prestador_id = req.params.id;
  db.all(`SELECT tipo, comentario FROM avaliacoes WHERE prestador_id = ?`, [prestador_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro' });
    const indica = rows.filter(r => r.tipo === 'indica').length;
    const nao_indica = rows.filter(r => r.tipo === 'nao_indica').length;
    const comentarios = rows.filter(r => r.tipo === 'indica' && r.comentario).map(r => r.comentario);
    res.json({ indica, nao_indica, comentarios });
  });
});

// 6.5. Cadastrar Prestador
app.post('/api/prestadores', authenticate, (req, res) => {
  const { nome, telefone, tipo, categoria_id, diferencial, endereco, email } = req.body;
  const { condominio_id, id: morador_id } = req.user;
  
  const cleanPhone = telefone.replace(/\D/g, '');
  if (cleanPhone.length < 10 || cleanPhone.length > 11) {
    return res.status(400).json({ error: 'Telefone inválido' });
  }

  const sql = `INSERT INTO prestadores (condominio_id, nome, telefone, tipo, categoria_principal_id, diferencial, endereco, email, cadastrado_por_morador_id) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [condominio_id, nome, cleanPhone, tipo, categoria_id, diferencial, endereco, email, morador_id], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Este telefone já está cadastrado' });
      }
      return res.status(500).json({ error: 'Erro ao cadastrar' });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// 6.6. Listar Categorias
app.get('/api/categorias', authenticate, (req, res) => {
  db.all(`SELECT * FROM categorias WHERE condominio_id = ? ORDER BY grupo, nome`, [req.user.condominio_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 7.1. Listar Moradores Pendentes (só Administrador)
app.get('/api/admin/moradores', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.all(`SELECT id, nome, unidade, telefone, status, eh_admin, created_at FROM moradores WHERE condominio_id = ? ORDER BY created_at DESC`, 
    [req.user.condominio_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 7.2. Aprovar/Rejeitar Morador
app.patch('/api/admin/moradores/:id/status', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  const { status } = req.body;
  db.run(`UPDATE moradores SET status = ? WHERE id = ? AND condominio_id = ?`, 
    [status, req.params.id, req.user.condominio_id], (err) => {
    if (err) return res.status(500).json({ error: 'Erro ao atualizar' });
    res.json({ success: true });
  });
});

// 7.3. Blacklist de Prestador
app.patch('/api/admin/prestadores/:id/blacklist', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  const { blacklisted } = req.body;
  db.run(`UPDATE prestadores SET blacklisted = ? WHERE id = ? AND condominio_id = ?`, 
    [blacklisted ? 1 : 0, req.params.id, req.user.condominio_id], (err) => {
    if (err) return res.status(500).json({ error: 'Erro ao atualizar' });
    res.json({ success: true });
  });
});

// 7.4. Excluir Prestador
app.delete('/api/admin/prestadores/:id', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.run(`DELETE FROM prestadores WHERE id = ? AND condominio_id = ?`, 
    [req.params.id, req.user.condominio_id], (err) => {
    if (err) return res.status(500).json({ error: 'Erro ao excluir' });
    res.json({ success: true });
  });
});

// 7.4.5. Listar Categorias (admin)
app.get('/api/admin/categorias', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.all(`SELECT * FROM categorias WHERE condominio_id = ? ORDER BY grupo, nome`, 
    [req.user.condominio_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 7.5. Criar Categoria
app.post('/api/admin/categorias', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  const { nome, grupo, cor } = req.body;
  db.run(`INSERT INTO categorias (condominio_id, nome, grupo, cor) VALUES (?, ?, ?, ?)`, 
    [req.user.condominio_id, nome, grupo, cor || '#6B7280'], function(err) {
    if (err) return res.status(500).json({ error: 'Erro ao criar' });
    res.json({ success: true, id: this.lastID });
  });
});

// 7.6. Mensagens ao Administrador - Listar
app.get('/api/admin/mensagens', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.all(`SELECT m.*, mo.nome as morador_nome, mo.unidade FROM mensagens m LEFT JOIN moradores mo ON m.morador_id = mo.id WHERE m.condominio_id = ? ORDER BY m.created_at DESC`, 
    [req.user.condominio_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 7.7. Marcar Mensagem como Lida
app.patch('/api/admin/mensagens/:id/lida', authenticate, (req, res) => {
  if (!req.user.eh_admin) return res.status(403).json({ error: 'Acesso negado' });
  db.run(`UPDATE mensagens SET lida = 1 WHERE id = ? AND condominio_id = ?`, 
    [req.params.id, req.user.condominio_id], (err) => {
    if (err) return res.status(500).json({ error: 'Erro ao atualizar' });
    res.json({ success: true });
  });
});

// 7.8. Enviar Mensagem ao Administrador (morador)
app.post('/api/mensagens', authenticate, (req, res) => {
  const { tipo, mensagem } = req.body;
  db.run(`INSERT INTO mensagens (condominio_id, morador_id, tipo, mensagem) VALUES (?, ?, ?, ?)`, 
    [req.user.condominio_id, req.user.id, tipo, mensagem], function(err) {
    if (err) return res.status(500).json({ error: 'Erro ao enviar' });
    res.json({ success: true });
  });
});

// 7.9. Dados do perfil do morador
app.get('/api/morador/perfil', authenticate, (req, res) => {
  db.get(`SELECT nome, unidade, telefone, eh_admin FROM moradores WHERE id = ?`, 
    [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(row);
  });
});

// 7.9.5. Listar Preços de um Prestador
app.get('/api/prestadores/:id/precos', authenticate, (req, res) => {
  db.all(`SELECT * FROM precos WHERE prestador_id = ? ORDER BY data_referencia DESC`, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 7.9.6. Adicionar Preço
app.post('/api/prestadores/:id/precos', authenticate, (req, res) => {
  const { tipo_preco, valor, data_referencia, inclui_transporte, inclui_produtos } = req.body;
  const { condominio_id } = req.user;
  
  const sql = `INSERT INTO precos (condominio_id, prestador_id, tipo_preco, valor, data_referencia, inclui_transporte, inclui_produtos) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [condominio_id, req.params.id, tipo_preco, valor || null, data_referencia, inclui_transporte ? 1 : 0, inclui_produtos ? 1 : 0], function(err) {
    if (err) return res.status(500).json({ error: 'Erro ao salvar' });
    res.json({ success: true, id: this.lastID });
  });
});

// 7.9.7. Comparar preços por categoria (para o gráfico)
app.get('/api/categorias/:categoria_id/precos', authenticate, (req, res) => {
  db.all(`
    SELECT p.nome as prestador_nome, pr.tipo_preco, pr.valor, pr.data_referencia 
    FROM precos pr 
    JOIN prestadores p ON pr.prestador_id = p.id 
    WHERE p.categoria_principal_id = ? AND pr.valor IS NOT NULL
    ORDER BY pr.valor ASC
  `, [req.params.categoria_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 7.10. Minhas Avaliações
app.get('/api/morador/avaliacoes', authenticate, (req, res) => {
  db.all(`SELECT a.*, p.nome as prestador_nome, p.telefone as prestador_telefone FROM avaliacoes a JOIN prestadores p ON a.prestador_id = p.id WHERE a.morador_telefone = ? ORDER BY a.updated_at DESC`, 
    [req.user.telefone], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    res.json(rows);
  });
});

// 7.11. Excluir Conta (LGPD)
app.delete('/api/morador/conta', authenticate, (req, res) => {
  db.run(`UPDATE moradores SET nome = 'Conta Excluída', unidade = '---', status = 'inativo', aceite_termos_data = NULL WHERE id = ?`, [req.user.id], (err) => {
    res.json({ success: true });
  });
});

// Rota para servir o index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 6.7. Editar Prestador (só admin ou quem cadastrou) - APARECE APENAS 1 VEZ
app.patch('/api/prestadores/:id', authenticate, (req, res) => {
  const { nome, telefone, tipo, categoria_id, diferencial } = req.body;
  const { id: morador_id, eh_admin, condominio_id } = req.user;
  const prestador_id = req.params.id;

  db.get(`SELECT * FROM prestadores WHERE id = ? AND condominio_id = ?`, 
    [prestador_id, condominio_id], (err, prestador) => {
    if (err || !prestador) return res.status(404).json({ error: 'Prestador não encontrado' });

    if (!eh_admin && prestador.cadastrado_por_morador_id !== morador_id) {
      return res.status(403).json({ error: 'Você não tem permissão para editar este prestador' });
    }

    const cleanPhone = telefone ? telefone.replace(/\D/g, '') : prestador.telefone;
    
    const sql = `UPDATE prestadores SET nome = ?, telefone = ?, tipo = ?, categoria_principal_id = ?, diferencial = ? WHERE id = ?`;
    db.run(sql, [
      nome || prestador.nome,
      cleanPhone,
      tipo || prestador.tipo,
      categoria_id || prestador.categoria_principal_id,
      diferencial !== undefined ? diferencial : prestador.diferencial,
      prestador_id
    ], function(err) {
      if (err) return res.status(500).json({ error: 'Erro ao atualizar' });
      res.json({ success: true });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando na porta ${PORT}`));