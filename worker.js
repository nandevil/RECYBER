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
   - MELHORENVIO_CLIENT_ID / MELHORENVIO_CLIENT_SECRET  (OAuth do
     aplicativo cadastrado no Melhor Envio — Passo 21 do SUPABASE.md)
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
    if (url.pathname === "/api/melhorenvio/authorize" && request.method === "GET") {
      return handleMelhorEnvioAuthorize(request, env);
    }
    if (url.pathname === "/api/melhorenvio/callback" && request.method === "GET") {
      return handleMelhorEnvioCallback(request, env);
    }
    if (url.pathname === "/api/melhorenvio/status" && request.method === "GET") {
      return handleMelhorEnvioStatus(request, env);
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

    /* A InfinitePay rejeita item com preço <= 0 (não dá pra mandar o
       desconto como uma linha negativa). Em vez disso, distribui o
       desconto proporcionalmente entre os preços dos itens — o total
       cobrado fica igual ao que o cliente já viu na tela do carrinho. */
    const itemsSubtotal = order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const discount = Number(order.discount) || 0;
    const ratio = discount > 0 && itemsSubtotal > 0
      ? Math.max(0.01, (itemsSubtotal - discount) / itemsSubtotal)
      : 1;

    const items = order.items.map(i => ({
      quantity: i.qty,
      price: Math.max(1, centavos(i.price * ratio)),
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
        "User-Agent": "Mozilla/5.0 (compatible; RecyberCheckout/1.0; +https://recyber.com.br)"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const detail = await res.text();
      // A Cloudflare não expõe o IP de saída do Worker (é dinâmico e
      // compartilhado) — o cf-ray identifica essa requisição específica
      // nos logs da própria Cloudflare/InfinitePay, que é o dado real
      // que o suporte deles consegue rastrear em caso de bloqueio (429/1015).
      const cfRay = res.headers.get("cf-ray") || "";
      const respDate = res.headers.get("date") || "";
      console.error("InfinitePay create-link falhou:", res.status, detail, "cf-ray:", cfRay, "date:", respDate);
      // DEBUG TEMPORÁRIO — remover "debug" da resposta antes de divulgar o checkout.
      return jsonResponse({ error: "Não foi possível gerar o link de pagamento.", debug: { status: res.status, detail, cfRay, date: respDate } }, 502);
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

/* =====================================================
   MELHOR ENVIO — conexão OAuth2 (Passo 21 do SUPABASE.md). O token
   fica guardado em public.melhorenvio_tokens (linha única, id=1),
   lido/escrito só com a service_role key — nunca exposto ao front-end.
===================================================== */
function supaHeaders(env) {
  return {
    "Content-Type": "application/json",
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
  };
}

function melhorEnvioMessagePage(text, ok) {
  return new Response(
    `<!doctype html><html><body style="font-family:monospace;background:#0e0e0e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px;">
      <p style="max-width:420px;">${ok ? "✅" : "❌"} ${text}</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/* Passo 1: manda o admin pra tela de login/autorização do Melhor
   Envio, guardando um "state" aleatório pra conferir no callback
   (proteção contra CSRF — sem isso, qualquer um poderia forjar a
   volta do callback e vincular a conta errada). */
async function handleMelhorEnvioAuthorize(request, env) {
  try {
    if (!env.MELHORENVIO_BASE_URL || !env.MELHORENVIO_CLIENT_ID) {
      console.error("Melhor Envio (authorize) — variáveis de ambiente faltando (MELHORENVIO_BASE_URL/MELHORENVIO_CLIENT_ID).");
      return melhorEnvioMessagePage("Configuração incompleta no Worker (faltam variáveis de ambiente). Veja o console.", false);
    }

    const origin = new URL(request.url).origin;
    const state = crypto.randomUUID();

    const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/melhorenvio_tokens?id=eq.1`, {
      method: "PATCH",
      headers: { ...supaHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify({ pending_state: state })
    });
    if (!patchRes.ok) {
      console.error("Melhor Envio (authorize) — falha ao salvar state:", await patchRes.text());
      return melhorEnvioMessagePage("Erro interno ao iniciar a conexão. Veja o console do Worker.", false);
    }

    const scope = encodeURIComponent("cart-write shipping-generate shipping-calculate");
    const redirectUri = encodeURIComponent(`${origin}/api/melhorenvio/callback`);
    const authorizeUrl = `${env.MELHORENVIO_BASE_URL}/oauth/authorize?client_id=${env.MELHORENVIO_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&state=${state}&scope=${scope}`;
    return Response.redirect(authorizeUrl, 302);
  } catch (err) {
    console.error("melhorenvio authorize:", err);
    return melhorEnvioMessagePage("Erro interno ao iniciar a conexão. Veja o console do Worker.", false);
  }
}

/* Passo 2: recebe o "code" de volta, confere o state salvo, troca o
   code por access_token/refresh_token e guarda no Supabase. */
async function handleMelhorEnvioCallback(request, env) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return melhorEnvioMessagePage("Autorização cancelada ou incompleta.", false);
    }

    const stateRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/melhorenvio_tokens?id=eq.1&select=pending_state`,
      { headers: supaHeaders(env) }
    );
    const stateRows = await stateRes.json();
    if (!stateRows[0] || stateRows[0].pending_state !== state) {
      return melhorEnvioMessagePage("Estado de autorização inválido — tente conectar de novo.", false);
    }

    const tokenRes = await fetch(`${env.MELHORENVIO_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "Re.cyber (atendimento@recyber.com.br)"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.MELHORENVIO_CLIENT_ID,
        client_secret: env.MELHORENVIO_CLIENT_SECRET,
        redirect_uri: `${url.origin}/api/melhorenvio/callback`,
        code
      })
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      console.error("Melhor Envio (callback) — troca de token falhou:", tokenRes.status, detail);
      return melhorEnvioMessagePage("Não foi possível concluir a conexão com o Melhor Envio. Veja o console do Worker.", false);
    }

    const tokenData = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const saveRes = await fetch(`${env.SUPABASE_URL}/rest/v1/melhorenvio_tokens?id=eq.1`, {
      method: "PATCH",
      headers: { ...supaHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        pending_state: null,
        updated_at: new Date().toISOString()
      })
    });
    if (!saveRes.ok) {
      console.error("Melhor Envio (callback) — falha ao salvar token:", await saveRes.text());
      return melhorEnvioMessagePage("Token recebido, mas houve erro ao salvar. Veja o console do Worker.", false);
    }

    return melhorEnvioMessagePage("Melhor Envio conectado com sucesso! Pode fechar esta aba.", true);
  } catch (err) {
    console.error("melhorenvio callback:", err);
    return melhorEnvioMessagePage("Erro interno ao concluir a conexão.", false);
  }
}

/* Status simples (conectado/não conectado + validade) pro painel
   exibir — nunca devolve o token em si. */
async function handleMelhorEnvioStatus(request, env) {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/melhorenvio_tokens?id=eq.1&select=access_token,expires_at`,
      { headers: supaHeaders(env) }
    );
    if (!res.ok) return jsonResponse({ connected: false });
    const rows = await res.json();
    const row = rows[0];
    return jsonResponse({ connected: !!(row && row.access_token), expiresAt: row ? row.expires_at : null });
  } catch (err) {
    console.error("melhorenvio status:", err);
    return jsonResponse({ connected: false });
  }
}
