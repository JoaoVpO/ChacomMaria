const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/health', (req, res) => res.json({ ok: true }));

const LIMITE_VAGAS = 160;

app.get('/api/inscricoes/limite', async (req, res) => {
  try {
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM clientes');
    return res.json({ total, limite: LIMITE_VAGAS, esgotado: total >= LIMITE_VAGAS });
  } catch (err) {
    console.error('Erro ao consultar limite de vagas', err);
    return res.status(500).json({ error: 'Falha ao consultar limite de vagas', detail: err.message });
  }
});

app.post('/api/inscricao', async (req, res) => {
  const { nome, email, cidade, telefone, quantidade, valor_total } = req.body || {};
  if (!nome || !email || !cidade || !telefone) {
    return res.status(400).json({ error: 'nome, email, cidade e telefone são obrigatórios' });
  }

  const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
  const valor = parseFloat(valor_total) || qtd * 63;

  try {
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM clientes');
    if (total >= LIMITE_VAGAS) {
      return res.status(409).json({ error: 'Vagas esgotadas', esgotado: true });
    }

    const [result] = await db.query(
      'INSERT INTO clientes (nome, email, cidade, telefone, quantidade, valor_total) VALUES (?, ?, ?, ?, ?, ?)',
      [nome, email, cidade, telefone, qtd, valor]
    );
    return res.json({ id: result.insertId });
  } catch (err) {
    console.error('Erro ao salvar inscrição', err);
    return res.status(500).json({ error: 'Falha ao salvar inscrição', detail: err.message });
  }
});

app.get('/api/inscricoes', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nome, telefone, cidade, quantidade, valor_total, status_pagamento FROM clientes ORDER BY id DESC'
    );
    return res.json({ inscricoes: rows });
  } catch (err) {
    console.error('Erro ao listar inscrições', err);
    return res.status(500).json({ error: 'Falha ao listar inscrições', detail: err.message });
  }
});

app.patch('/api/inscricoes/:id/pagamento', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!['pendente', 'pago'].includes(status)) {
    return res.status(400).json({ error: 'status deve ser "pendente" ou "pago"' });
  }

  try {
    await db.query('UPDATE clientes SET status_pagamento = ? WHERE id = ?', [status, id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao atualizar pagamento', err);
    return res.status(500).json({ error: 'Falha ao atualizar pagamento', detail: err.message });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Chá com Maria backend rodando na porta ${PORT}`));