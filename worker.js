/* =====================================================
   WORKER — serve o site estático (via binding ASSETS) e responde às
   rotas de API do checkout integrado com a InfinitePay.

   Documentação usada (Checkout Integrado, InfinitePay):
   - POST https://api.checkout.infinitepay.io/links  (cria o link de pagamento)
   - POST https://api.checkout.infinitepay.io/payment_check  (confirma uma transação)
   Preços sempre em CENTAVOS.

   Segredos necessários (configure com `wrangler secret put <nome>`,
   veja SUPABASE.md — Passo 10):
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY  (nunca exponha isso no front-end)
   - INFINITEPAY_HANDLE  (sua InfiniteTag, ex: "recyber")
   - RESEND_API_KEY  (Resend, para /api/send-email — Passo 14 do SUPABASE.md)
===================================================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-payment" && request.method === "POST") {
      return handleCreatePayment(request, env);
    }
    if (url.pathname === "/api/webhook/infinitepay" && request.method === "POST") {
      return handleInfinitePayWebhook(request, env);
    }
    if (url.pathname === "/api/send-email" && request.method === "POST") {
      return handleSendEmail(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/* Cria o link de pagamento hospedado pela InfinitePay (PIX ou cartão —
   o cliente escolhe na própria página deles) para um pedido já salvo
   no Supabase com status "pendente". */
async function handleCreatePayment(request, env) {
  try {
    const { order } = await request.json();
    if (!order || !order.id || !Array.isArray(order.items) || order.items.length === 0) {
      return jsonResponse({ error: "Pedido inválido." }, 400);
    }

    const origin = new URL(request.url).origin;
    const centavos = v => Math.round(Number(v) * 100);

    const items = order.items.map(i => ({
      quantity: i.qty,
      price: centavos(i.price),
      description: `${i.name} (Tam. ${i.size})`.slice(0, 120)
    }));
    if (order.shipping > 0) {
      items.push({ quantity: 1, price: centavos(order.shipping), description: "Frete" });
    }

    const payload = {
      handle: env.INFINITEPAY_HANDLE,
      redirect_url: `${origin}/?pedido=${encodeURIComponent(order.id)}`,
      webhook_url: `${origin}/api/webhook/infinitepay`,
      order_nsu: order.id,
      items,
      customer: {
        name: order.customer?.nome,
        email: order.customer?.email,
        phone_number: order.customer?.telefone
      }
    };

    const res = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; RecyberCheckout/1.0; +https://recyber.anandalage18.workers.dev)"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("InfinitePay create-link falhou:", res.status, detail);
      // DEBUG TEMPORÁRIO — remover "debug" da resposta antes de divulgar o checkout.
      return jsonResponse({ error: "Não foi possível gerar o link de pagamento.", debug: { status: res.status, detail } }, 502);
    }

    const data = await res.json();
    if (!data.url) return jsonResponse({ error: "Resposta inesperada da InfinitePay." }, 502);

    return jsonResponse({ url: data.url });
  } catch (err) {
    console.error("create-payment:", err);
    return jsonResponse({ error: "Erro interno ao criar o pagamento." }, 500);
  }
}

/* Recebe o aviso de pagamento da InfinitePay, CONFIRMA a transação
   direto com a API deles (não confia cegamente no corpo do webhook —
   qualquer um poderia forjar essa chamada) e só então marca o pedido
   como "pago" no Supabase. Resposta esperada de /payment_check:
   { success: true, paid: true, amount, paid_amount, installments, ... } */
async function handleInfinitePayWebhook(request, env) {
  try {
    const payload = await request.json();
    const { order_nsu, transaction_nsu, slug } = payload || {};
    if (!order_nsu || !transaction_nsu) {
      return jsonResponse({ success: false }, 400);
    }

    const checkRes = await fetch("https://api.checkout.infinitepay.io/payment_check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: env.INFINITEPAY_HANDLE, order_nsu, transaction_nsu, slug })
    });
    const checkData = await checkRes.json().catch(() => null);
    console.log("PAYMENT_CHECK_RESPONSE", checkRes.status, JSON.stringify(checkData));

    const confirmed = checkRes.ok && checkData &&
      (checkData.success === true || checkData.paid === true || checkData.status === "paid");
    if (!confirmed) {
      return jsonResponse({ success: false });
    }

    const supaRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(order_nsu)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ payment_status: "pago" })
      }
    );
    if (!supaRes.ok) {
      console.error("Erro ao atualizar pedido no Supabase:", await supaRes.text());
      return jsonResponse({ success: false }, 502);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("webhook infinitepay:", err);
    return jsonResponse({ success: false }, 500);
  }
}

/* Envia um e-mail transacional via Resend (REST direto, sem SDK — não
   temos build step no projeto). Documentação: POST /emails com
   Authorization: Bearer <API key>, corpo { from, to, subject, html }. */
async function handleSendEmail(request, env) {
  try {
    const { to, subject, html } = await request.json();
    if (!to || !subject || !html) {
      return jsonResponse({ error: "Faltam campos obrigatórios (to, subject, html)." }, 400);
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "Re.cyber <atendimento@recyber.com.br>",
        to: [to],
        subject,
        html
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend falhou:", res.status, detail);
      return jsonResponse({ error: "Não foi possível enviar o e-mail." }, 502);
    }

    const data = await res.json();
    return jsonResponse({ id: data.id });
  } catch (err) {
    console.error("send-email:", err);
    return jsonResponse({ error: "Erro interno ao enviar o e-mail." }, 500);
  }
}
