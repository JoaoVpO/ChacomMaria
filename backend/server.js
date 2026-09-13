const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { criarPagamentoPix, buscarPagamento } = require('./mercadopago');
require('dotenv').config();

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/health', (req, res) => res.json({ ok: true }));

const LIMITE_VAGAS = 150;

app.get('/api/inscricoes/limite', async (req, res) => {
  try {
    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM clientes WHERE status_pagamento IN ('pago', 'admin')");
    return res.json({ total, limite: LIMITE_VAGAS, esgotado: total >= LIMITE_VAGAS });
  } catch (err) {
    console.error('Erro ao consultar limite de vagas', err);
    return res.status(500).json({ error: 'Falha ao consultar limite de vagas', detail: err.message });
  }
});

app.post('/api/inscricao', async (req, res) => {
  const { nome, cidade, telefone, quantidade, valor_total } = req.body || {};
  if (!nome || !cidade || !telefone) {
    return res.status(400).json({ error: 'nome, cidade e telefone são obrigatórios' });
  }

  const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
  const valor = parseFloat(valor_total) || qtd * 63;
  const telefoneNormalizado = telefone.replace(/\D/g, '');

  try {
    // Evita duplicar: se esse telefone já tem inscrição em aberto, reaproveita em vez de criar outra
    const [[existente]] = await db.query(
      "SELECT id FROM clientes WHERE REGEXP_REPLACE(telefone, '[^0-9]', '') = ? AND status_pagamento IN ('pendente', 'pago') LIMIT 1",
      [telefoneNormalizado]
    );
    if (existente) {
      return res.json({ id: existente.id });
    }

    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM clientes WHERE status_pagamento IN ('pago', 'admin')");
    if (total >= LIMITE_VAGAS) {
      return res.status(409).json({ error: 'Vagas esgotadas', esgotado: true });
    }

    const [result] = await db.query(
      "INSERT INTO clientes (nome, email, cidade, telefone, quantidade, valor_total, origem) VALUES (?, ?, ?, ?, ?, ?, 'site')",
      [nome, '', cidade, telefoneNormalizado, qtd, valor]
    );
    return res.json({ id: result.insertId });
  } catch (err) {
    console.error('Erro ao salvar inscrição', err);
    return res.status(500).json({ error: 'Falha ao salvar inscrição', detail: err.message });
  }
});

app.post('/api/inscricoes/manual', async (req, res) => {
  const { nome, cidade, telefone, quantidade, valor_total, status_pagamento } = req.body || {};
  if (!nome || !cidade || !telefone) {
    return res.status(400).json({ error: 'nome, cidade e telefone são obrigatórios' });
  }

  const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
  const valor = parseFloat(valor_total) || qtd * 63;
  const status = ['pendente', 'admin'].includes(status_pagamento) ? status_pagamento : 'pago';

  try {
    // Inscrição manual (feita pelo admin) não conta pro limite de vagas do site
    const [result] = await db.query(
      "INSERT INTO clientes (nome, email, cidade, telefone, quantidade, valor_total, status_pagamento, origem) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')",
      [nome, '', cidade, telefone, qtd, valor, status]
    );
    return res.json({ id: result.insertId });
  } catch (err) {
    console.error('Erro ao adicionar inscrição manual', err);
    return res.status(500).json({ error: 'Falha ao adicionar inscrição', detail: err.message });
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
  if (!['pendente', 'pago', 'admin'].includes(status)) {
    return res.status(400).json({ error: 'status deve ser "pendente", "pago" ou "admin"' });
  }

  try {
    await db.query('UPDATE clientes SET status_pagamento = ? WHERE id = ?', [status, id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao atualizar pagamento', err);
    return res.status(500).json({ error: 'Falha ao atualizar pagamento', detail: err.message });
  }
});

app.delete('/api/inscricoes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM clientes WHERE id = ?', [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao remover inscrição', err);
    return res.status(500).json({ error: 'Falha ao remover inscrição', detail: err.message });
  }
});

function respostaPix(pagamento) {
  const dados = pagamento.point_of_interaction?.transaction_data || {};
  return {
    payment_id: pagamento.id,
    status: pagamento.status,
    qr_code: dados.qr_code || null,
    qr_code_base64: dados.qr_code_base64 || null,
  };
}

app.post('/api/inscricao/:id/pix', async (req, res) => {
  const { id } = req.params;
  try {
    const [[cliente]] = await db.query('SELECT * FROM clientes WHERE id = ?', [id]);
    if (!cliente) return res.status(404).json({ error: 'Inscrição não encontrada' });

    if (cliente.status_pagamento === 'pago') {
      return res.json({ payment_id: cliente.mp_payment_id, status: 'approved' });
    }

    if (cliente.mp_payment_id) {
      const pagamentoExistente = await buscarPagamento(cliente.mp_payment_id);
      if (pagamentoExistente.status === 'approved') {
        await db.query('UPDATE clientes SET status_pagamento = ? WHERE id = ?', ['pago', id]);
        return res.json(respostaPix(pagamentoExistente));
      }
      if (pagamentoExistente.status !== 'rejected' && pagamentoExistente.status !== 'cancelled') {
        return res.json(respostaPix(pagamentoExistente));
      }
      // se foi rejeitado/cancelado, cai pra baixo e gera um novo Pix
    }

    const notificationUrl = `${req.protocol}://${req.get('host')}/api/mercadopago/webhook`;
    const pagamento = await criarPagamentoPix({
      inscricaoId: cliente.id,
      valor: cliente.valor_total,
      nome: cliente.nome,
      notificationUrl,
    });
    await db.query('UPDATE clientes SET mp_payment_id = ? WHERE id = ?', [pagamento.id, id]);
    return res.json(respostaPix(pagamento));
  } catch (err) {
    console.error('Erro ao gerar Pix', err);
    return res.status(500).json({ error: 'Falha ao gerar pagamento Pix', detail: err.message });
  }
});

app.get('/api/inscricao/:id/status', async (req, res) => {
  const { id } = req.params;
  try {
    const [[cliente]] = await db.query('SELECT status_pagamento FROM clientes WHERE id = ?', [id]);
    if (!cliente) return res.status(404).json({ error: 'Inscrição não encontrada' });
    return res.json({ status: cliente.status_pagamento });
  } catch (err) {
    console.error('Erro ao consultar status', err);
    return res.status(500).json({ error: 'Falha ao consultar status' });
  }
});

app.post('/api/mercadopago/webhook', async (req, res) => {
  try {
    const paymentId = req.body?.data?.id || req.query['data.id'] || req.query.id;
    const tipo = req.body?.type || req.query.type || req.query.topic;

    if (tipo === 'payment' && paymentId) {
      const pagamento = await buscarPagamento(paymentId);
      const inscricaoId = pagamento.external_reference;
      if (pagamento.status === 'approved' && inscricaoId) {
        await db.query('UPDATE clientes SET status_pagamento = ? WHERE id = ?', ['pago', inscricaoId]);
        console.log(`Pagamento aprovado via webhook — inscrição #${inscricaoId}`);
      }
    }
  } catch (err) {
    console.error('Erro ao processar webhook do Mercado Pago', err);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Chá com Maria backend rodando na porta ${PORT}`));