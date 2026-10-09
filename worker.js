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
   - ADMIN_API_TOKEN  (token de automação de cadastro de peça —
     NÃO é a senha do painel, é um segredo só pra essa rota, veja
     Passo 25 do SUPABASE.md)

   Fotos ficam no bucket R2 "recyber-images" (binding IMAGES no
   wrangler.toml), não mais no Supabase Storage — egress do R2 é
   sempre grátis, o que tirou as fotos do consumo de tráfego que
   travava o projeto no Supabase. R2_PUBLIC_URL (var em wrangler.toml)
   é a URL pública (Public Development URL) do bucket.
===================================================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // [assets] directory = "./" no wrangler.toml serve a raiz inteira do
    // repo — inclui arquivos internos (código-fonte, docs de setup,
    // scripts, histórico do git) que nunca deveriam ir pro público. Bloqueia
    // isso aqui antes de qualquer outra rota ou do fallback pro ASSETS.
    if (isBlockedAssetPath(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }

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
    if (url.pathname === "/api/melhorenvio/services" && request.method === "GET") {
      return handleMelhorEnvioServices(request, env);
    }
    if (url.pathname === "/api/admin/add-product" && request.method === "POST") {
      return handleAdminAddProduct(request, env);
    }
    if (url.pathname === "/feed.xml" && request.method === "GET") {
      return handleProductFeed(env);
    }
    if (url.pathname === "/feed-produtos.csv" && request.method === "GET") {
      return handleProductFeedCsv(env);
    }
    if (url.pathname === "/api/admin/set-category-cover" && request.method === "POST") {
      return handleSetCategoryCover(request, env);
    }
    if (url.pathname === "/api/admin/mark-order-paid" && request.method === "POST") {
      return handleAdminMarkOrderPaid(request, env);
    }
    if (url.pathname === "/api/admin/webhook-logs" && request.method === "GET") {
      return handleAdminWebhookLogs(request, env);
    }
    if (url.pathname === "/tiktok-feed.csv" && request.method === "GET") {
      return handleTikTokFeedCsv(env);
    }
    if (url.pathname === "/tiktok-feed-feminino.csv" && request.method === "GET") {
      return handleTikTokFeedCsv(env, "feminino");
    }
    if (url.pathname === "/tiktok-feed-masculino.csv" && request.method === "GET") {
      return handleTikTokFeedCsv(env, "masculino");
    }
    if (url.pathname === "/api/admin/upload-image" && request.method === "POST") {
      return handleAdminUploadImage(request, env);
    }

    if (url.pathname === "/" && request.method === "GET" && url.searchParams.get("produto")) {
      return handleProductPreview(request, env, ctx, url);
    }
    if (url.pathname === "/api/catalog" && request.method === "GET") {
      return handleCatalog(request, env, ctx);
    }
    if (url.pathname === "/api/track" && request.method === "POST") {
      return handleTrackVisit(request, env);
    }
    if (url.pathname === "/api/admin/send-finance-report" && request.method === "POST") {
      return handleAdminSendFinanceReport(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  // Cron Trigger (wrangler.toml [triggers]) — dia 1º de cada mês.
  async scheduled(event, env, ctx) {
    if (event.cron === USAGE_CHECK_CRON) {
      ctx.waitUntil(checkSupabaseUsage(env).catch(err => console.error("Alerta de uso:", err)));
      return;
    }
    ctx.waitUntil(sendMonthlyFinanceReport(env).catch(err => console.error("Relatório mensal:", err)));
  }
};

// Extensões/arquivos/pastas que nunca podem ser servidos publicamente,
// mesmo estando dentro da raiz apontada por [assets] directory no
// wrangler.toml. Checagem por prefixo de path (sempre em minúsculas).
const BLOCKED_PATH_PREFIXES = [
  "/.git/",
  "/.gitignore",
  "/.claude/",
  "/wrangler.toml",
  "/supabase.md",
  "/server.ps1",
  "/test-pagamento.html",
  "/worker.js",
  "/recyber/",
  "/package.json",
  "/package-lock.json",
];

function isBlockedAssetPath(pathname) {
  const lower = pathname.toLowerCase();
  return BLOCKED_PATH_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(prefix));
}

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
      return jsonResponse({ error: "Não foi possível gerar o link de pagamento." }, 502);
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
      await logWebhookAttempt(env, { source: "infinitepay", payload, response: null, confirmed: false, note: "faltou order_nsu/transaction_nsu no corpo do webhook" });
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

    await logWebhookAttempt(env, {
      source: "infinitepay",
      payload,
      response: { status: checkRes.status, body: checkData },
      confirmed,
      note: confirmed ? null : "payment_check não confirmou pagamento (ver response)"
    });

    if (!confirmed) {
      return jsonResponse({ success: false });
    }

    try {
      await confirmOrderPaid(order_nsu, env);
    } catch (err) {
      console.error("Erro ao confirmar pedido pago:", err);
      return jsonResponse({ success: false }, 502);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("webhook infinitepay:", err);
    return jsonResponse({ success: false }, 500);
  }
}

/* Grava uma tentativa de webhook pra diagnóstico (Passo 29 do
   SUPABASE.md) — nunca lança erro (se a tabela não existir ainda,
   ou qualquer outro problema, só loga e segue, pra nunca derrubar o
   webhook de pagamento de verdade por causa disso). */
async function logWebhookAttempt(env, { source, payload, response, confirmed, note }) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/webhook_logs`, {
      method: "POST",
      headers: { ...supaHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify({ source, payload, response, confirmed, note })
    });
  } catch (err) {
    console.warn("logWebhookAttempt falhou (não crítico):", err.message);
  }
}

/* Roda tudo que precisa acontecer quando um pedido é confirmado como
   pago — usado tanto pelo webhook automático da InfinitePay quanto
   pelo painel (quando o dono marca "Pagamento Concluído" manualmente,
   ex: pagamento combinado fora do checkout). Cada efeito colateral tem
   seu próprio try/catch: uma falha no e-mail ou no Melhor Envio nunca
   deve impedir os outros nem a confirmação do pagamento em si. */
async function confirmOrderPaid(orderId, env) {
  const supaRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    {
      method: "PATCH",
      headers: { ...supaHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify({ payment_status: "pago" })
    }
  );
  if (!supaRes.ok) {
    throw new Error(`Falha ao atualizar pedido no Supabase (status ${supaRes.status}): ${await supaRes.text()}`);
  }

  /* Avisa o cliente por e-mail que o pagamento foi confirmado. */
  try {
    await sendPaymentConfirmedEmail(orderId, env);
  } catch (err) {
    console.error("E-mail de pagamento confirmado:", err);
  }

  /* Marca cada peça comprada como "esgotada" — peça única, vendida
     uma vez não volta a aparecer disponível no catálogo. */
  try {
    await markOrderProductsAsSold(orderId, env);
  } catch (err) {
    console.error("Marcar peças como esgotadas:", err);
  }

  /* Gera a etiqueta no carrinho do Melhor Envio. */
  try {
    await createMelhorEnvioCartEntry(orderId, env);
  } catch (err) {
    console.error("Melhor Envio (pós-pagamento):", err);
  }
}

/* Busca o pedido pago e manda o aviso de "pagamento confirmado" pro
   cliente — mensagem fixa (pedida pelo dono da loja), avisando que o
   código de rastreio vem depois e que pode cair em spam. */
async function sendPaymentConfirmedEmail(orderId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,customer`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );
  if (!res.ok) throw new Error(`Falha ao buscar pedido pro e-mail de confirmação (status ${res.status}).`);
  const rows = await res.json();
  const order = rows[0];
  if (!order || !order.customer || !order.customer.email) return;

  const html = `<!doctype html>
    <html><head><meta charset="UTF-8"></head>
    <body style="margin:0;">
    <div style="background:#0e0e0e;padding:32px 16px;font-family:'Courier New',monospace;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border:2px solid #161616;border-radius:10px;padding:28px;">
        <p style="font-family:monospace;font-weight:bold;font-size:15px;letter-spacing:1px;margin:0 0 20px;">RE<span style="color:#2f8f4e;">.</span>CYBER</p>
        <h1 style="font-size:14px;letter-spacing:.5px;margin:0 0 16px;">Pagamento confirmado — ${escapeXml(order.id)}</h1>
        <div style="font-size:14px;line-height:1.6;color:#161616;">
          <p style="margin:0;">Parabéns pela compra! Seu código de rastreio será enviado por e-mail assim que o produto for postado. Fique de olho: ele pode ir para a caixa de spam ou lixo eletrônico. O e-mail será enviado pela Melhor Envio.</p>
        </div>
        <hr style="border:none;border-top:1px solid #dededd;margin:24px 0 16px;">
        <p style="font-size:11px;color:#8a8a86;margin:0;">Re.cyber — Slow Fashion Brechó · recyber.com.br</p>
      </div>
    </div>
    </body></html>`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: "Re.cyber <atendimento@recyber.com.br>",
      to: [order.customer.email],
      subject: "Pagamento confirmado — Re.cyber",
      html
    })
  });
  if (!emailRes.ok) {
    console.error("E-mail de pagamento confirmado falhou:", emailRes.status, await emailRes.text());
  }
}

/* Marca cada peça do pedido pago como esgotada (public.products,
   coluna is_sold — Passo 24 do SUPABASE.md). Peça única: uma vez
   vendida, some do catálogo disponível pra sempre, sem apagar o
   registro (histórico continua existindo). */
async function markOrderProductsAsSold(orderId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=items`,
    { headers: supaHeaders(env) }
  );
  if (!res.ok) throw new Error(`Falha ao buscar itens do pedido (status ${res.status}).`);
  const rows = await res.json();
  const order = rows[0];
  if (!order || !Array.isArray(order.items) || order.items.length === 0) return;

  const productIds = order.items.map(i => i.id).filter(Boolean);
  if (productIds.length === 0) return;

  const idsList = productIds.map(id => encodeURIComponent(id)).join(",");
  const updateRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/products?id=in.(${idsList})`,
    {
      method: "PATCH",
      headers: { ...supaHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify({ is_sold: true })
    }
  );
  if (!updateRes.ok) {
    console.error("Falha ao marcar peças como esgotadas:", updateRes.status, await updateRes.text());
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

/* =====================================================
   R2 — armazenamento de fotos (substitui o Supabase Storage, que
   cobra/bloqueia por tráfego). Egress do R2 é sempre grátis, então as
   fotos param de consumir a cota do Supabase. O bucket é privado por
   padrão pro binding do Worker escrever; a leitura pública acontece
   via R2_PUBLIC_URL (Public Development URL do bucket).
===================================================== */
async function uploadImageToR2(base64, filename, contentType, env, folder = "") {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const cleanName = (filename || "foto").replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${folder ? folder + "/" : ""}${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${cleanName}`;
  await env.IMAGES.put(path, bytes, {
    httpMetadata: { contentType: contentType || "image/jpeg" }
  });
  return `${env.R2_PUBLIC_URL}/${path}`;
}

/* Upload de foto pro painel logado (cadastro de peça, feedback etc.) —
   antes ia direto do navegador pro Supabase Storage via SDK; agora
   precisa passar pelo Worker porque o R2 não tem um SDK público
   seguro pra chamar direto do navegador. Exige sessão do dono (mesmo
   padrão do /api/admin/mark-order-paid), não o ADMIN_API_TOKEN (esse
   é só pra automação sem login). */
async function handleAdminUploadImage(request, env) {
  try {
    const auth = request.headers.get("Authorization") || "";
    const userToken = auth.replace(/^Bearer\s+/i, "");
    if (!userToken) return jsonResponse({ error: "Não autorizado." }, 401);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${userToken}` }
    });
    if (!userRes.ok) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);

    const { filename, contentType, base64, folder } = await request.json();
    if (!base64) return jsonResponse({ error: "Faltou a imagem." }, 400);

    const url = await uploadImageToR2(base64, filename, contentType, env, folder || "");
    return jsonResponse({ ok: true, url });
  } catch (err) {
    console.error("admin upload-image:", err);
    return jsonResponse({ error: err.message || "Erro interno." }, 500);
  }
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
      console.error("Melhor Envio (authorize) — falha ao salvar state:", patchRes.status, await patchRes.text());
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

/* Lista as transportadoras/serviços disponíveis na conta conectada,
   com o ID exato de cada um — a documentação do Melhor Envio avisa
   que esses números NÃO são um catálogo fixo, cada conta pode ter
   números diferentes, então é preciso perguntar direto pra API em
   vez de adivinhar. Usado só pra descobrir o ID a colocar no painel
   (Configurações de Envio); não expõe token nenhum. */
async function handleMelhorEnvioServices(request, env) {
  try {
    const accessToken = await getMelhorEnvioAccessToken(env);
    const res = await fetch(`${env.MELHORENVIO_BASE_URL}/api/v2/me/shipment/companies`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Re.cyber (atendimento@recyber.com.br)"
      }
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("Melhor Envio (services):", res.status, detail);
      return jsonResponse({ error: "Não foi possível listar os serviços.", detail }, 502);
    }
    return jsonResponse(await res.json());
  } catch (err) {
    console.error("melhorenvio services:", err);
    return jsonResponse({ error: err.message || "Erro interno." }, 500);
  }
}

/* Endereço fixo da loja (remetente) — SUPABASE.md Passo 22 documenta
   como isso poderia virar configurável pelo painel no futuro; por
   ora fica fixo aqui, a pedido do dono da loja. */
const MELHORENVIO_SENDER = {
  name: "Re.cyber",
  phone: "22999390065",
  email: "anandalage18@hotmail.com",
  document: "14997264733",
  company_document: "",
  state_register: "",
  address: "Avenida Gladstone José De Oliveira",
  complement: "",
  number: "355",
  district: "Praça Da Bandeira",
  city: "Araruama",
  country_id: "BR",
  postal_code: "28979660",
  state_abbr: "RJ"
};

/* Garante um access_token válido — renova sozinho com o refresh_token
   quando estiver perto de expirar (a InfinitePay já ensinou a lição:
   nunca confiar que um token "vai durar", sempre checar antes de usar). */
async function getMelhorEnvioAccessToken(env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/melhorenvio_tokens?id=eq.1&select=access_token,refresh_token,expires_at`,
    { headers: supaHeaders(env) }
  );
  if (!res.ok) throw new Error("Não foi possível ler o token do Melhor Envio no Supabase.");
  const rows = await res.json();
  const row = rows[0];
  if (!row || !row.access_token) throw new Error("Melhor Envio não conectado ainda.");

  const expiresSoon = !row.expires_at || new Date(row.expires_at).getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return row.access_token;

  if (!row.refresh_token) throw new Error("Token do Melhor Envio expirado, sem refresh_token salvo.");

  const refreshRes = await fetch(`${env.MELHORENVIO_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "Re.cyber (atendimento@recyber.com.br)"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.MELHORENVIO_CLIENT_ID,
      client_secret: env.MELHORENVIO_CLIENT_SECRET,
      refresh_token: row.refresh_token
    })
  });
  if (!refreshRes.ok) {
    console.error("Melhor Envio — falha ao renovar token:", refreshRes.status, await refreshRes.text());
    throw new Error("Não foi possível renovar o token do Melhor Envio.");
  }
  const tokenData = await refreshRes.json();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  await fetch(`${env.SUPABASE_URL}/rest/v1/melhorenvio_tokens?id=eq.1`, {
    method: "PATCH",
    headers: { ...supaHeaders(env), Prefer: "return=minimal" },
    body: JSON.stringify({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || row.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    })
  });

  return tokenData.access_token;
}

/* Monta os volumes: um objeto idêntico por PEÇA comprada (não por
   linha do pedido) — pedido com 3 peças = 3 volumes, usando sempre a
   medida padrão configurada no painel. Correios/J&T/Loggi não aceitam
   múltiplos volumes numa etiqueta só; nesse caso funde tudo num único
   volume (peso somado, maior dimensão de cada eixo) como fallback. */
function buildMelhorEnvioVolumes(items, settings, mergeIntoOne) {
  const totalQty = items.reduce((n, i) => n + i.qty, 0);
  const base = {
    height: Number(settings.height_cm),
    width: Number(settings.width_cm),
    length: Number(settings.length_cm),
    weight: Number(settings.weight_kg)
  };
  if (mergeIntoOne) {
    return [{
      height: base.height,
      width: base.width,
      length: base.length * totalQty,
      weight: Number((base.weight * totalQty).toFixed(3))
    }];
  }
  return Array.from({ length: totalQty }, () => ({ ...base }));
}

function onlyDigits(v) {
  return (v || "").replace(/\D/g, "");
}

/* Todos os IDs de serviço habilitados na conta — consultado toda vez
   (não cacheado) pra sempre refletir o que está disponível agora,
   caso o dono habilite/desabilite transportadoras no futuro. */
async function getAllMelhorEnvioServiceIds(accessToken, env) {
  const res = await fetch(`${env.MELHORENVIO_BASE_URL}/api/v2/me/shipment/companies`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Re.cyber (atendimento@recyber.com.br)"
    }
  });
  if (!res.ok) throw new Error(`Não foi possível listar as transportadoras (status ${res.status}).`);
  const companies = await res.json();
  return companies.flatMap(c => c.services.map(s => s.id));
}

/* Cota TODOS os serviços habilitados de uma vez e devolve o mais
   barato. Serviços indisponíveis pro CEP/pacote em questão voltam com
   um campo "error" em vez de preço — esses são ignorados no
   rankeamento, não travam o processo. */
async function pickCheapestMelhorEnvioService(order, settings, accessToken, env, mergeVolumes) {
  const serviceIds = await getAllMelhorEnvioServiceIds(accessToken, env);
  const payload = {
    from: { postal_code: MELHORENVIO_SENDER.postal_code },
    to: { postal_code: onlyDigits(order.customer.cep) },
    volumes: buildMelhorEnvioVolumes(order.items, settings, mergeVolumes),
    options: { insurance_value: Number(order.total) || 0 },
    services: serviceIds.join(",")
  };
  const res = await fetch(`${env.MELHORENVIO_BASE_URL}/api/v2/me/shipment/calculate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Re.cyber (atendimento@recyber.com.br)"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Falha ao cotar frete (status ${res.status}): ${await res.text()}`);

  const results = await res.json();
  const valid = (Array.isArray(results) ? results : [results]).filter(r => r.custom_price && !r.error);
  if (valid.length === 0) throw new Error("Nenhum serviço de envio disponível pra esse destino/pacote.");

  valid.sort((a, b) => parseFloat(a.custom_price) - parseFloat(b.custom_price));
  return valid[0];
}

async function buildMelhorEnvioCartPayload(order, settings, mergeVolumes, serviceId) {
  return {
    service: Number(serviceId),
    from: MELHORENVIO_SENDER,
    to: {
      name: order.customer.nome,
      phone: onlyDigits(order.customer.telefone),
      email: order.customer.email,
      document: onlyDigits(order.customer.cpf),
      company_document: "",
      state_register: "ISENTO",
      address: order.customer.logradouro,
      complement: order.customer.complemento || "",
      number: order.customer.numero,
      district: order.customer.bairro,
      city: order.customer.cidade || "",
      country_id: "BR",
      postal_code: onlyDigits(order.customer.cep),
      state_abbr: order.customer.uf || ""
    },
    products: order.items.map(i => ({
      name: i.name,
      quantity: String(i.qty),
      unitary_value: String(i.price)
    })),
    volumes: buildMelhorEnvioVolumes(order.items, settings, mergeVolumes),
    options: {
      insurance_value: Number(order.total) || 0,
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: true,
      platform: "Re.cyber",
      tags: [{ tag: order.id, url: `https://recyber.com.br/?pedido=${encodeURIComponent(order.id)}` }]
    }
  };
}

/* Chamada de fato pra API do Melhor Envio, com uma tentativa de
   fallback (funde os volumes em um só) se a primeira bater na
   restrição de "múltiplos volumes não suportados" de certas
   transportadoras — evita ter que adivinhar de antemão qual serviço
   aceita ou não. */
async function postMelhorEnvioCart(payload, accessToken, env) {
  return fetch(`${env.MELHORENVIO_BASE_URL}/api/v2/me/cart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Re.cyber (atendimento@recyber.com.br)"
    },
    body: JSON.stringify(payload)
  });
}

/* Ponto de entrada chamado pelo webhook de pagamento aprovado. Busca
   o pedido completo + as configurações de envio, monta o payload e
   insere no carrinho do Melhor Envio. Loga qualquer problema sem
   nunca lançar erro pra fora (quem chama já engole exceções, mas
   melhor deixar explícito aqui também). */
async function createMelhorEnvioCartEntry(orderId, env) {
  const log = (confirmed, note, response) => logWebhookAttempt(env, { source: "melhorenvio", payload: { orderId }, response: response ?? null, confirmed, note });

  const [orderRes, settingsRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, { headers: supaHeaders(env) }),
    fetch(`${env.SUPABASE_URL}/rest/v1/shipping_settings?id=eq.1&select=*`, { headers: supaHeaders(env) })
  ]);
  if (!orderRes.ok || !settingsRes.ok) {
    const detail = { orderStatus: orderRes.status, settingsStatus: settingsRes.status };
    console.error("Melhor Envio — falha ao buscar pedido/configurações:", await orderRes.text().catch(() => ""), await settingsRes.text().catch(() => ""));
    await log(false, "Falha ao buscar pedido/configurações no Supabase", detail);
    return;
  }
  const orders = await orderRes.json();
  const settingsRows = await settingsRes.json();
  const orderRow = orders[0];
  const settings = settingsRows[0];

  if (!orderRow) {
    console.error("Melhor Envio — pedido não encontrado:", orderId);
    await log(false, "Pedido não encontrado na tabela orders");
    return;
  }
  if (!settings) {
    console.warn("Melhor Envio — Configurações de Envio (medidas) não cadastradas ainda. Etiqueta não gerada para", orderId);
    await log(false, "Linha shipping_settings (id=1) não existe — Passo 20 do SUPABASE.md não rodado");
    return;
  }

  const order = { id: orderRow.id, total: orderRow.total, customer: orderRow.customer, items: orderRow.items };

  let accessToken;
  try {
    accessToken = await getMelhorEnvioAccessToken(env);
  } catch (err) {
    console.error("Melhor Envio — token indisponível:", err.message);
    await log(false, "Token da Melhor Envio indisponível: " + err.message);
    return;
  }

  /* Se um serviço específico estiver fixado no painel, usa ele direto
     (sem cotar). Senão — o padrão — cota TODOS os serviços habilitados
     e usa o mais barato disponível pra esse destino/pacote. */
  let serviceId = settings.melhorenvio_service_id;
  if (!serviceId) {
    try {
      const cheapest = await pickCheapestMelhorEnvioService(order, settings, accessToken, env, false);
      serviceId = cheapest.id;
      console.log(`Melhor Envio — serviço mais barato pra ${orderId}: ${cheapest.company.name} ${cheapest.name} (R$ ${cheapest.custom_price})`);
    } catch (err) {
      console.error("Melhor Envio — falha ao cotar frete:", err.message);
      await log(false, "Falha ao cotar frete (nenhum serviço disponível pro destino/pacote): " + err.message);
      return;
    }
  }

  const totalQty = order.items.reduce((n, i) => n + i.qty, 0);
  let payload = await buildMelhorEnvioCartPayload(order, settings, false, serviceId);
  let res = await postMelhorEnvioCart(payload, accessToken, env);

  if (!res.ok && totalQty > 1) {
    const detail = await res.text();
    if (/volume/i.test(detail)) {
      console.warn("Melhor Envio — transportadora não aceita múltiplos volumes, tentando com volume único:", detail);
      payload = await buildMelhorEnvioCartPayload(order, settings, true, serviceId);
      res = await postMelhorEnvioCart(payload, accessToken, env);
    } else {
      console.error("Melhor Envio — falha ao inserir no carrinho:", res.status, detail);
      await log(false, "Falha ao inserir no carrinho da Melhor Envio", { status: res.status, detail });
      return;
    }
  }

  if (!res.ok) {
    const detail = await res.text();
    console.error("Melhor Envio — falha ao inserir no carrinho:", res.status, detail);
    await log(false, "Falha ao inserir no carrinho da Melhor Envio (após tentativa de volume único)", { status: res.status, detail });
    return;
  }

  console.log("Melhor Envio — etiqueta inserida no carrinho com sucesso para", orderId);
  await log(true, "Etiqueta inserida no carrinho com sucesso", { serviceId });
}

/* =====================================================
   CADASTRO AUTOMATIZADO DE PEÇA — rota protegida por token (não é a
   senha do painel), usada pra permitir cadastrar peças fora do
   navegador (via automação), sem exigir login interativo. Recebe as
   fotos já em base64, sobe pro Storage e insere a peça, tudo com a
   service_role key (mesmo nível de confiança do painel logado).
===================================================== */
async function handleAdminAddProduct(request, env) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (!env.ADMIN_API_TOKEN || auth !== `Bearer ${env.ADMIN_API_TOKEN}`) {
      return jsonResponse({ error: "Não autorizado." }, 401);
    }

    const body = await request.json();
    const { name, price, size, sizes, category, gender, description, tag, images } = body || {};
    if (!name || !category) {
      return jsonResponse({ error: "Faltam campos obrigatórios (name, category)." }, 400);
    }
    /* "sizes" (array [{size,measurements}]) é o formato novo — quando
       vem preenchido, o campo legado "size" (texto simples) é montado
       a partir dele, pra continuar funcionando em qualquer lugar do
       código que ainda lê só o texto. */
    const sizesArray = Array.isArray(sizes) ? sizes.filter(s => s && s.size) : [];
    const sizeText = sizesArray.length > 0 ? sizesArray.map(s => s.size).join(", ") : (size || "");

    const imageUrls = [];
    for (const img of (images || [])) {
      const url = await uploadImageToR2(img.base64, img.filename, img.contentType, env);
      imageUrls.push(url);
    }

    const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/products`, {
      method: "POST",
      headers: { ...supaHeaders(env), Prefer: "return=representation" },
      body: JSON.stringify({
        name,
        price: Number(price) || 0,
        size: sizeText,
        sizes: sizesArray,
        category,
        gender: gender || "unissex",
        description: description || "",
        image_urls: imageUrls,
        tag: tag || ""
      })
    });
    if (!insertRes.ok) {
      const detail = await insertRes.text();
      return jsonResponse({ error: "Falha ao inserir produto.", detail }, 502);
    }

    const data = await insertRes.json();
    return jsonResponse({ ok: true, product: data[0] });
  } catch (err) {
    console.error("admin add-product:", err);
    return jsonResponse({ error: err.message || "Erro interno." }, 500);
  }
}

/* Feed de produtos (formato RSS/Google Shopping, aceito pelo Meta
   Commerce Manager pra montar o catálogo do Instagram Shopping) — lê
   direto do Supabase, então reflete o catálogo publicado sem trabalho
   manual. Cada item aponta pra "https://recyber.com.br/?produto=ID",
   que o js/catalog-sync.js abre automaticamente na peça certa. */
function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  }[c]));
}

async function handleProductFeed(env) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/products?select=*`, {
      headers: supaHeaders(env)
    });
    if (!res.ok) {
      const detail = await res.text();
      return new Response(`Erro ao buscar produtos: ${detail}`, { status: 502 });
    }
    const products = await res.json();

    const items = products
      .filter(p => Array.isArray(p.image_urls) && p.image_urls.length > 0)
      .map(p => {
        const link = `https://recyber.com.br/?produto=${encodeURIComponent(p.id)}`;
        const price = (Number(p.price) || 0).toFixed(2);
        return `  <item>
    <g:id>${escapeXml(p.id)}</g:id>
    <g:title>${escapeXml(p.name)}</g:title>
    <g:description>${escapeXml(p.description || p.name)}</g:description>
    <g:link>${escapeXml(link)}</g:link>
    <g:image_link>${escapeXml(p.image_urls[0])}</g:image_link>
    <g:availability>${p.is_sold ? "out of stock" : "in stock"}</g:availability>
    <g:price>${price} BRL</g:price>
    <g:condition>used</g:condition>
    <g:brand>Re.cyber</g:brand>
  </item>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>Re.cyber</title>
  <link>https://recyber.com.br</link>
  <description>Catálogo de produtos — Re.cyber, Slow Fashion Brechó</description>
${items}
</channel>
</rss>`;

    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
  } catch (err) {
    console.error("feed:", err);
    return new Response("Erro interno.", { status: 500 });
  }
}

const GOOGLE_PRODUCT_CATEGORY = {
  camisas: "Apparel & Accessories > Clothing > Shirts & Tops",
  blusas: "Apparel & Accessories > Clothing > Shirts & Tops",
  saias: "Apparel & Accessories > Clothing > Skirts",
  vestidos: "Apparel & Accessories > Clothing > Dresses",
  shorts: "Apparel & Accessories > Clothing > Shorts",
  bermudas: "Apparel & Accessories > Clothing > Shorts",
  calcas: "Apparel & Accessories > Clothing > Pants",
  "casacos-sobreposicoes": "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets",
  bolsas: "Apparel & Accessories > Handbags, Wallets & Cases > Handbags",
  sapatos: "Apparel & Accessories > Shoes"
};

/* Campo de CSV: só cerca com aspas quando precisa (vírgula, aspas ou
   quebra de linha no valor) — aspas internas viram "" (regra padrão). */
function csvField(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* Feed em CSV pro Meta Commerce Manager (Gerenciador de Comércio →
   Fontes de dados → "Usar um URL"). Diferente do /feed.xml: aqui todo
   link aponta pra home (não pra peça específica) e inclui a categoria
   do Google — formato pedido explicitamente pra essa integração. */
async function handleProductFeedCsv(env) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/products?select=*`, {
      headers: supaHeaders(env)
    });
    if (!res.ok) {
      const detail = await res.text();
      return new Response(`Erro ao buscar produtos: ${detail}`, { status: 502 });
    }
    const products = await res.json();

    const header = "id,title,description,availability,condition,price,link,image_link,brand,google_product_category";
    const rows = products
      .filter(p => Array.isArray(p.image_urls) && p.image_urls.length > 0)
      .map(p => {
        const price = (Number(p.price) || 0).toFixed(2);
        const category = GOOGLE_PRODUCT_CATEGORY[p.category] || "Apparel & Accessories > Clothing";
        return [
          p.id,
          p.name,
          p.description || p.name,
          p.is_sold ? "out of stock" : "in stock",
          "used",
          `${price} BRL`,
          "https://recyber.com.br/",
          p.image_urls[0],
          "Re.cyber",
          category
        ].map(csvField).join(",");
      });

    const csv = [header, ...rows].join("\r\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8" } });
  } catch (err) {
    console.error("feed csv:", err);
    return new Response("Erro interno.", { status: 500 });
  }
}

/* Mapeamento pras categorias do TikTok Shop, um por gênero — extraído
   dos modelos de planilha baixados no Seller Center (Vestidos =
   feminino, Camisas = masculino). Bolsas e Sapatos ficam de fora por
   enquanto: são árvores de categoria à parte, sem modelo baixado
   ainda. Só produtos com gênero+categoria mapeados aqui entram no
   export. */
const TIKTOK_CATEGORY_FEMININO = {
  vestidos: "Vestidos femininos/Vestidos casuais",
  blusas: "Peças femininas para parte superior/Blusas e camisas",
  camisas: "Peças femininas para parte superior/Camisetas",
  saias: "Peças femininas para parte inferior/Saias",
  shorts: "Peças femininas para parte inferior/Shorts",
  bermudas: "Peças femininas para parte inferior/Shorts",
  calcas: "Peças femininas para parte inferior/Calças",
  "casacos-sobreposicoes": "Peças femininas para parte superior/Jaquetas e casacos"
};
const TIKTOK_CATEGORY_MASCULINO = {
  camisas: "Peças masculinas para parte superior/Camisetas",
  blusas: "Peças masculinas para parte superior/Camisetas",
  shorts: "Peças masculinas para parte inferior/Shorts",
  bermudas: "Peças masculinas para parte inferior/Shorts",
  calcas: "Peças masculinas para parte inferior/Calças",
  "casacos-sobreposicoes": "Peças masculinas para parte superior/Jaquetas e casacos"
};
const TIKTOK_CATEGORY_BY_GENDER = {
  feminino: TIKTOK_CATEGORY_FEMININO,
  masculino: TIKTOK_CATEGORY_MASCULINO
};

/* Gera as LINHAS de dados (sem cabeçalho de instrução/dropdown) no
   formato exato do modelo de carga em massa do TikTok Shop Seller
   Center (32 colunas, uma linha por tamanho/variação) — pra colar a
   partir da linha 7 do arquivo .xlsx baixado de lá, não pra subir
   direto (o modelo deles tem validações internas que não recriamos).
   Só produtos com gênero+categoria mapeados (feminino ou masculino);
   o resto (unissex, bolsas, sapatos) fica de fora até termos os
   outros modelos — ver TIKTOK_CATEGORY_BY_GENDER. */
async function handleTikTokFeedCsv(env, genderFilter) {
  try {
    const [productsRes, settingsRes] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/products?select=*`, { headers: supaHeaders(env) }),
      fetch(`${env.SUPABASE_URL}/rest/v1/shipping_settings?id=eq.1&select=*`, { headers: supaHeaders(env) })
    ]);
    if (!productsRes.ok) {
      return new Response(`Erro ao buscar produtos: ${await productsRes.text()}`, { status: 502 });
    }
    const products = await productsRes.json();
    const settingsRows = settingsRes.ok ? await settingsRes.json() : [];
    const settings = settingsRows[0] || { weight_kg: 0.5, length_cm: 15, width_cm: 15, height_cm: 15 };

    const header = [
      "category", "brand", "product_name", "product_description", "main_image",
      "image_2", "image_3", "image_4", "image_5", "image_6", "image_7", "image_8", "image_9",
      "gtin_type", "gtin_code",
      "property_name_1", "property_value_1", "property_1_image",
      "property_name_2", "property_value_2",
      "parcel_weight", "parcel_length", "parcel_width", "parcel_height",
      "delivery", "price", "quantity", "seller_sku",
      "minimum_order_quantity", "maximum_order_quantity", "cumulative_order_quantity",
      "size_chart"
    ].join(",");

    const skipped = [];
    const rows = [];
    for (const p of products) {
      if (genderFilter && p.gender !== genderFilter) continue;
      const categoryTable = TIKTOK_CATEGORY_BY_GENDER[p.gender];
      const category = categoryTable ? categoryTable[p.category] : null;
      const images = Array.isArray(p.image_urls) ? p.image_urls : [];
      if (!category || images.length === 0) {
        skipped.push(p.id);
        continue;
      }
      const sizeRows = Array.isArray(p.sizes) && p.sizes.length > 0
        ? p.sizes
        : [{ size: (p.size && p.size !== "Único") ? p.size : "Único" }];

      for (const s of sizeRows) {
        rows.push([
          category,
          "", // brand — brechó não tem marca própria por peça
          p.name,
          p.description || p.name,
          images[0] || "",
          images[1] || "", images[2] || "", images[3] || "", images[4] || "",
          images[5] || "", images[6] || "", images[7] || "", images[8] || "",
          "", "", // gtin_type, gtin_code — peça usada, sem código de barras
          "Tamanho", s.size || "Único", "",
          "", "", // property_name_2/value_2 — só uma dimensão de variação (tamanho)
          Math.round((Number(settings.weight_kg) || 0.5) * 1000), // kg -> g
          Number(settings.length_cm) || 15,
          Number(settings.width_cm) || 15,
          Number(settings.height_cm) || 15,
          "", // delivery — herda config da loja
          (Number(p.price) || 0).toFixed(2),
          p.is_sold ? 0 : 1,
          `${p.id}-${(s.size || "unico").replace(/[^a-zA-Z0-9]/g, "")}`,
          1, "", "", ""
        ].map(csvField).join(","));
      }
    }

    const csv = [header, ...rows].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "X-Skipped-Products": skipped.length.toString()
      }
    });
  } catch (err) {
    console.error("tiktok feed csv:", err);
    return jsonResponse({ error: err.message || "Erro interno." }, 500);
  }
}

/* Define a foto de capa de uma categoria (card da tela "Categorias")
   sem precisar abrir o painel — mesmo token de automação do
   /api/admin/add-product (Passo 25/27 do SUPABASE.md). Sobe a foto pro
   R2 e faz upsert em public.category_covers. */
async function handleSetCategoryCover(request, env) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (!env.ADMIN_API_TOKEN || auth !== `Bearer ${env.ADMIN_API_TOKEN}`) {
      return jsonResponse({ error: "Não autorizado." }, 401);
    }

    const body = await request.json();
    const { category, image } = body || {};
    if (!category || !image || !image.base64) {
      return jsonResponse({ error: "Faltam campos obrigatórios (category, image)." }, 400);
    }

    const imageUrl = await uploadImageToR2(image.base64, image.filename || "capa", image.contentType, env, `category-covers/${category}`);

    const upsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/category_covers`, {
      method: "POST",
      headers: {
        ...supaHeaders(env),
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({ category, image_url: imageUrl, updated_at: new Date().toISOString() })
    });
    if (!upsertRes.ok) {
      const detail = await upsertRes.text();
      return jsonResponse({ error: "Falha ao salvar capa da categoria.", detail }, 502);
    }

    const data = await upsertRes.json();
    return jsonResponse({ ok: true, cover: data[0] });
  } catch (err) {
    console.error("admin set-category-cover:", err);
    return jsonResponse({ error: err.message || "Erro interno." }, 500);
  }
}

/* Confirma manualmente um pedido como pago direto do painel (ex:
   pagamento combinado por fora, Pix confirmado no banco). Antes disso
   o botão do painel só fazia UPDATE de payment_status — não disparava
   "peça esgotada" nem a etiqueta do Melhor Envio, porque esses efeitos
   só existiam dentro do webhook automático da InfinitePay. Agora os
   dois caminhos chamam a mesma confirmOrderPaid(). Autenticação: exige
   uma sessão válida do dono logado (mesmo nível de confiança das
   políticas RLS "to authenticated") — não usa o ADMIN_API_TOKEN, que é
   escopado só pra cadastro/automação, não pra confirmar pagamentos. */
async function handleAdminMarkOrderPaid(request, env) {
  try {
    const auth = request.headers.get("Authorization") || "";
    const userToken = auth.replace(/^Bearer\s+/i, "");
    if (!userToken) return jsonResponse({ error: "Não autorizado." }, 401);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${userToken}`
      }
    });
    if (!userRes.ok) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);

    const { orderId } = await request.json();
    if (!orderId) return jsonResponse({ error: "Faltou orderId." }, 400);

    await confirmOrderPaid(orderId, env);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("admin mark-order-paid:", err);
    return jsonResponse({ error: err.message || "Erro interno." }, 500);
  }
}

/* =====================================================
   RELATÓRIO FINANCEIRO MENSAL POR E-MAIL (Passo 35 do SUPABASE.md)
   Roda sozinho no dia 1º (Cron Trigger) e manda o resumo do mês
   ANTERIOR pro REPORT_EMAIL: recebimentos (pedidos pagos), gastos
   (tabela expenses, por categoria) e lucro. Mês fechado em horário de
   Brasília (UTC-3).
===================================================== */
function previousMonthKeyBrt() {
  const brt = new Date(Date.now() - 3 * 3600 * 1000);
  let y = brt.getUTCFullYear();
  let m = brt.getUTCMonth(); // 0-based: mês atual - 1 = mês anterior em 1-based
  if (m === 0) { y -= 1; m = 12; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function brl(n) {
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function buildFinanceReport(monthKey, env) {
  const [y, m] = monthKey.split("-").map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, 1, 3)).toISOString();
  const endUtc = new Date(Date.UTC(y, m, 1, 3)).toISOString();
  const nextKey = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;

  const ordersRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?payment_status=eq.pago&created_at=gte.${encodeURIComponent(startUtc)}&created_at=lt.${encodeURIComponent(endUtc)}&select=total,shipping&limit=5000`,
    { headers: supaHeaders(env) }
  );
  if (!ordersRes.ok) throw new Error(`Falha ao buscar pedidos (status ${ordersRes.status}).`);
  const orders = await ordersRes.json();
  const receipts = orders.reduce((s, o) => s + Math.max((Number(o.total) || 0) - (Number(o.shipping) || 0), 0), 0);
  const shippingTotal = orders.reduce((s, o) => s + (Number(o.shipping) || 0), 0);

  let expenses = [];
  let expensesMissing = false;
  const expRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/expenses?spent_at=gte.${monthKey}-01&spent_at=lt.${nextKey}-01&select=category,amount&limit=5000`,
    { headers: supaHeaders(env) }
  );
  if (expRes.ok) expenses = await expRes.json();
  else expensesMissing = true;

  const byCategory = {};
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + (Number(e.amount) || 0); });
  const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  return { monthKey, salesCount: orders.length, receipts, shippingTotal, totalExpenses, profit: receipts - totalExpenses, byCategory, expensesMissing };
}

function financeReportHtml(r) {
  const [y, m] = r.monthKey.split("-");
  const label = `${m}/${y}`;
  const margin = r.receipts > 0 ? `${((r.profit / r.receipts) * 100).toFixed(1).replace(".", ",")}%` : "—";
  const profitColor = r.profit >= 0 ? "#1f7a3d" : "#b3261e";
  const catRows = Object.entries(r.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, v]) => `<tr><td style="padding:4px 0;">${escapeXml(cat)}</td><td style="padding:4px 0;text-align:right;">${brl(v)}</td></tr>`)
    .join("");
  const note = r.expensesMissing
    ? `<p style="font-size:12px;color:#b3261e;">Gastos não carregados: a tabela "expenses" ainda não existe no Supabase (Passo 35).</p>`
    : "";

  return `<!doctype html>
    <html><head><meta charset="UTF-8"></head>
    <body style="margin:0;">
    <div style="background:#0e0e0e;padding:32px 16px;font-family:'Courier New',monospace;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border:2px solid #161616;border-radius:10px;padding:28px;">
        <p style="font-family:monospace;font-weight:bold;font-size:15px;letter-spacing:1px;margin:0 0 20px;">RE<span style="color:#2f8f4e;">.</span>CYBER</p>
        <h1 style="font-size:14px;letter-spacing:.5px;margin:0 0 16px;">Relatório financeiro — ${escapeXml(label)}</h1>
        <table style="width:100%;font-size:14px;color:#161616;border-collapse:collapse;">
          <tr><td style="padding:4px 0;">Recebimentos das peças (${r.salesCount} venda${r.salesCount === 1 ? "" : "s"} paga${r.salesCount === 1 ? "" : "s"})</td><td style="padding:4px 0;text-align:right;">${brl(r.receipts)}</td></tr>
          <tr><td style="padding:4px 0;color:#8a8a86;">Frete pago pelos clientes (não é ganho)</td><td style="padding:4px 0;text-align:right;color:#8a8a86;">${brl(r.shippingTotal)}</td></tr>
          <tr><td style="padding:4px 0;">Gastos</td><td style="padding:4px 0;text-align:right;">${brl(r.totalExpenses)}</td></tr>
          <tr><td style="padding:8px 0;border-top:1px solid #dededd;"><strong>Lucro</strong></td><td style="padding:8px 0;border-top:1px solid #dededd;text-align:right;color:${profitColor};"><strong>${brl(r.profit)}</strong></td></tr>
          <tr><td style="padding:4px 0;">Margem</td><td style="padding:4px 0;text-align:right;">${margin}</td></tr>
        </table>
        ${catRows ? `<p style="font-size:12px;margin:20px 0 6px;color:#8a8a86;">GASTOS POR CATEGORIA</p><table style="width:100%;font-size:13px;color:#161616;border-collapse:collapse;">${catRows}</table>` : ""}
        ${note}
        <hr style="border:none;border-top:1px solid #dededd;margin:24px 0 16px;">
        <p style="font-size:11px;color:#8a8a86;margin:0;">Detalhes completos na aba Financeiro do painel · recyber.com.br</p>
      </div>
    </div>
    </body></html>`;
}

async function sendMonthlyFinanceReport(env, monthKey = previousMonthKeyBrt()) {
  if (!env.REPORT_EMAIL) throw new Error("REPORT_EMAIL não configurado no wrangler.toml.");
  const report = await buildFinanceReport(monthKey, env);
  const [y, m] = monthKey.split("-");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "Re.cyber <atendimento@recyber.com.br>",
      to: [env.REPORT_EMAIL],
      subject: `Relatório financeiro ${m}/${y} — Re.cyber`,
      html: financeReportHtml(report)
    })
  });
  if (!res.ok) throw new Error(`Resend falhou (status ${res.status}): ${await res.text()}`);
  return report;
}

/* Teste manual: botão futuro/curl com a sessão do dono logado.
   Corpo opcional { month: "YYYY-MM" } (padrão: mês anterior). */
async function handleAdminSendFinanceReport(request, env) {
  try {
    const auth = request.headers.get("Authorization") || "";
    const userToken = auth.replace(/^Bearer\s+/i, "");
    if (!userToken) return jsonResponse({ error: "Não autorizado." }, 401);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${userToken}` }
    });
    if (!userRes.ok) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);

    let month;
    try { ({ month } = await request.json()); } catch (_) { /* corpo vazio */ }
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return jsonResponse({ error: "Mês inválido (use YYYY-MM)." }, 400);
    }

    const report = await sendMonthlyFinanceReport(env, month || undefined);
    return jsonResponse({ ok: true, month: report.monthKey });
  } catch (err) {
    console.error("admin send-finance-report:", err);
    return jsonResponse({ error: "Não foi possível enviar o relatório." }, 500);
  }
}

/* =====================================================
   CATÁLOGO EM CACHE + ALERTA DE USO DO SUPABASE (Passo 37)
   /api/catalog devolve as peças (mesmas linhas do select * da
   tabela products) com cache de borda de 60s, pra o tráfego de
   visitantes não bater no Supabase a cada visita (plano Free tem
   cota de egress). O Cron semanal avisa por e-mail quando o banco
   passa de 80% dos 500 MB do plano Free.
===================================================== */
const USAGE_CHECK_CRON = "0 12 * * 1";
const FREE_DB_LIMIT_BYTES = 500 * 1024 * 1024;

async function handleCatalog(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/catalog", request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/products?select=*&order=created_at.desc`,
    { headers: supaHeaders(env) }
  );
  if (!res.ok) {
    console.error("catalog:", res.status);
    return jsonResponse({ error: "Catálogo indisponível." }, 502);
  }
  const response = new Response(await res.text(), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=20, s-maxage=60"
    }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

/* =====================================================
   PRÉVIA DE LINK POR PEÇA (Open Graph)
   WhatsApp/Instagram/TikTok/Facebook não executam JavaScript, então as
   tags og:* da peça precisam estar no HTML. Em /?produto=ID (o mesmo
   link que o feed e os posts usam) buscamos a peça e reescrevemos as
   tags do index.html com HTMLRewriter. A peça fica 5 min em cache de
   borda (só a linha, nunca o HTML) pra não gastar cota do Supabase.
===================================================== */
const OG_DEFAULT_IMAGE = "https://recyber.com.br/img/og-default.png";

async function getPreviewProduct(id, env, ctx) {
  const cache = caches.default;
  const key = new Request(`https://recyber.com.br/__og-product/${encodeURIComponent(id)}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=id,name,price,size,image_urls,is_sold&limit=1`,
    { headers: supaHeaders(env) }
  );
  if (!res.ok) return null;
  const row = (await res.json())[0] || null;
  if (row) {
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(row), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=300" }
    })));
  }
  return row;
}

async function handleProductPreview(request, env, ctx, url) {
  const id = url.searchParams.get("produto");
  const page = await env.ASSETS.fetch(request);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return page;

  let product = null;
  try { product = await getPreviewProduct(id, env, ctx); } catch (err) { console.error("og preview:", err); }
  if (!product || !product.name) return page;

  const price = brl(Number(product.price) || 0);
  const size = product.size || "Único";
  const photo = Array.isArray(product.image_urls) && /^https:\/\//.test(product.image_urls[0] || "")
    ? product.image_urls[0] : OG_DEFAULT_IMAGE;
  const title = `${product.name} — ${price} | Re.cyber`;
  const description = product.is_sold
    ? `Esgotada: ${product.name}. Peça única do brechó Re.cyber — veja as outras peças disponíveis.`
    : `${price} · Tam. ${size} · Peça única do brechó Re.cyber (Slow Fashion, Rio de Janeiro). Corre, só existe uma!`;
  const pageUrl = `https://recyber.com.br/?produto=${encodeURIComponent(id)}`;

  const setContent = value => ({ element(el) { el.setAttribute("content", value); } });
  const drop = { element(el) { el.remove(); } };

  const rewritten = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(title); } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", pageUrl); } })
    .on('meta[name="description"]', setContent(description))
    .on('meta[property="og:type"]', setContent("product"))
    .on('meta[property="og:url"]', setContent(pageUrl))
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[property="og:image"]', setContent(photo))
    .on('meta[property="og:image:alt"]', setContent(product.name))
    .on('meta[property="og:image:width"]', drop)
    .on('meta[property="og:image:height"]', drop)
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[name="twitter:description"]', setContent(description))
    .on('meta[name="twitter:image"]', setContent(photo))
    .on("head", { element(el) {
      el.append(
        `<meta property="product:price:amount" content="${(Number(product.price) || 0).toFixed(2)}">` +
        `<meta property="product:price:currency" content="BRL">`,
        { html: true }
      );
    } })
    .transform(page);

  const headers = new Headers(rewritten.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(rewritten.body, { status: page.status, headers });
}

async function checkSupabaseUsage(env) {
  if (!env.REPORT_EMAIL) throw new Error("REPORT_EMAIL não configurado.");
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/db_size_bytes`, {
    method: "POST",
    headers: { ...supaHeaders(env), "Content-Type": "application/json" },
    body: "{}"
  });
  if (!res.ok) throw new Error(`db_size_bytes falhou (status ${res.status}).`);
  const bytes = Number(await res.json());
  const pct = (bytes / FREE_DB_LIMIT_BYTES) * 100;
  if (pct < 80) return { pct };

  const mb = (bytes / 1024 / 1024).toFixed(0);
  const mail = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "Re.cyber <atendimento@recyber.com.br>",
      to: [env.REPORT_EMAIL],
      subject: "Alerta: banco do Supabase passou de 80% do plano Free",
      html: `<p style="font-family:Arial,sans-serif;font-size:14px;">O banco de dados do Re.cyber está em <b>${mb} MB</b> (${pct.toFixed(0)}% dos 500 MB do plano Free).</p>
             <p style="font-family:Arial,sans-serif;font-size:14px;">Se chegar a 100%, o projeto pode ficar somente-leitura. Veja a página Usage no Supabase e considere subir de plano.</p>`
    })
  });
  if (!mail.ok) throw new Error(`Resend falhou (status ${mail.status}).`);
  return { pct, alerted: true };
}

/* =====================================================
   MÉTRICAS DE CHEGADA (Passo 36 do SUPABASE.md)
   js/tracking.js avisa 1x por sessão. Aqui classificamos a origem
   (utm > navegador interno do app > referrer) e somamos num contador
   por dia/origem via função SQL track_visit. Não guarda IP, cookie
   nem dado pessoal.
===================================================== */
const TRACK_SOURCE_ALIASES = {
  ig: "instagram", instagram: "instagram", tiktok: "tiktok", tt: "tiktok",
  fb: "facebook", facebook: "facebook", google: "google", youtube: "youtube",
  yt: "youtube", whatsapp: "whatsapp", wpp: "whatsapp", pinterest: "pinterest",
  twitter: "twitter", x: "twitter", email: "email", newsletter: "email"
};

const TRACK_REFERRER_HOSTS = [
  ["instagram", /(^|\.)instagram\.com$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["facebook", /(^|\.)(facebook\.com|fb\.com|fb\.me)$/],
  ["google", /(^|\.)google\.[a-z.]+$/],
  ["bing", /(^|\.)bing\.com$/],
  ["duckduckgo", /(^|\.)duckduckgo\.com$/],
  ["whatsapp", /(^|\.)(whatsapp\.com|wa\.me)$/],
  ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/],
  ["pinterest", /(^|\.)pinterest\.[a-z.]+$/],
  ["twitter", /(^|\.)(twitter\.com|t\.co|x\.com)$/]
];

function cleanTrackLabel(value, max = 40) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, max);
}

function classifyTrafficSource({ utmSource, referrer, userAgent }) {
  const utm = cleanTrackLabel(utmSource);
  if (utm) return TRACK_SOURCE_ALIASES[utm] || utm;

  if (/Instagram/i.test(userAgent)) return "instagram";
  if (/musical_ly|TikTok|Bytedance/i.test(userAgent)) return "tiktok";
  if (/FBAN|FBAV|FB_IAB/i.test(userAgent)) return "facebook";
  if (/Pinterest/i.test(userAgent)) return "pinterest";

  if (referrer) {
    let host = "";
    try { host = new URL(referrer).hostname.toLowerCase(); } catch (_) { /* referrer inválido */ }
    if (host && !/(^|\.)recyber\.com\.br$/.test(host)) {
      const hit = TRACK_REFERRER_HOSTS.find(([, re]) => re.test(host));
      return hit ? hit[0] : "outros";
    }
  }
  return "direto";
}

async function handleTrackVisit(request, env) {
  try {
    const userAgent = request.headers.get("User-Agent") || "";
    if (!userAgent || /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|monitor|lighthouse/i.test(userAgent)) {
      return new Response(null, { status: 204 });
    }

    let body = {};
    try { body = await request.json(); } catch (_) { /* corpo vazio */ }

    const source = classifyTrafficSource({
      utmSource: body.utm_source,
      referrer: typeof body.ref === "string" ? body.ref.slice(0, 300) : "",
      userAgent
    });
    const medium = cleanTrackLabel(body.utm_medium);
    const campaign = [medium, cleanTrackLabel(body.utm_campaign)].filter(Boolean).join("/");
    const device = /Mobi|Android|iPhone|iPad/i.test(userAgent) ? "celular" : "computador";
    const cf = request.cf || {};
    const region = cf.country === "BR" && cf.regionCode ? `BR-${cf.regionCode}` : (cf.country || "");
    const day = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // dia em Brasília

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/track_visit`, {
      method: "POST",
      headers: { ...supaHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ p_day: day, p_source: source, p_campaign: campaign, p_device: device, p_region: region })
    });
    if (!res.ok) console.error("track_visit falhou:", res.status, await res.text());

    return jsonResponse({ source, campaign });
  } catch (err) {
    console.error("track:", err);
    return new Response(null, { status: 204 });
  }
}

/* Só pra diagnóstico (Passo 29 do SUPABASE.md) — mostra as últimas
   tentativas de webhook de pagamento gravadas em public.webhook_logs,
   pra descobrir por que o status não muda sozinho sem precisar de
   acesso aos logs do Cloudflare. Protegido pelo ADMIN_API_TOKEN (não
   exige login do dono porque é só leitura de diagnóstico técnico, sem
   dado de cliente sensível além do que já está no pedido). */
async function handleAdminWebhookLogs(request, env) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (!env.ADMIN_API_TOKEN || auth !== `Bearer ${env.ADMIN_API_TOKEN}`) {
      return jsonResponse({ error: "Não autorizado." }, 401);
    }

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/webhook_logs?select=*&order=created_at.desc&limit=20`,
      { headers: supaHeaders(env) }
    );
    if (!res.ok) {
      const detail = await res.text();
      return jsonResponse({ error: "Falha ao buscar logs.", detail }, 502);
    }
    const logs = await res.json();
    return jsonResponse({ logs });
  } catch (err) {
    console.error("admin webhook-logs:", err);
    return jsonResponse({ error: err.message || "Erro interno." }, 500);
  }
}
