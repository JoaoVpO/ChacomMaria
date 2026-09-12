const BASE_URL = 'https://api.mercadopago.com';

function getAccessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado');
  return token;
}

async function criarPagamentoPix({ inscricaoId, valor, nome, notificationUrl }) {
  const resp = await fetch(`${BASE_URL}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAccessToken()}`,
      'X-Idempotency-Key': `inscricao-${inscricaoId}`,
    },
    body: JSON.stringify({
      transaction_amount: Number(valor),
      description: `Chá com Maria - Inscrição #${inscricaoId}`,
      payment_method_id: 'pix',
      payer: {
        email: `inscricao${inscricaoId}@chacommaria.app`,
        first_name: (nome || 'Convidado').split(' ')[0],
      },
      notification_url: notificationUrl,
      external_reference: String(inscricaoId),
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.message || `Erro ao criar pagamento Pix (HTTP ${resp.status})`);
  }
  return data;
}

async function buscarPagamento(paymentId) {
  const resp = await fetch(`${BASE_URL}/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${getAccessToken()}` },
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.message || `Erro ao consultar pagamento (HTTP ${resp.status})`);
  }
  return data;
}

module.exports = { criarPagamentoPix, buscarPagamento };
