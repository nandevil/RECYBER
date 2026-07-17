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
    if (url.pathname === "/api/melhorenvio/services" && request.method === "GET") {
      return handleMelhorEnvioServices(request, env);
    }
    if (url.pathname === "/api/melhorenvio/test-cart" && request.method === "GET") {
      return handleMelhorEnvioTestCart(request, env);
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

    /* Gera a etiqueta no carrinho do Melhor Envio em segundo plano —
       nunca deve derrubar a confirmação de pagamento pro cliente, por
       isso tem seu próprio try/catch e não afeta a resposta abaixo. */
    try {
      await createMelhorEnvioCartEntry(order_nsu, env);
    } catch (err) {
      console.error("Melhor Envio (pós-pagamento):", err);
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

/* DEBUG TEMPORÁRIO — dispara a mesma função que o webhook de
   pagamento chama, pra testar a geração de etiqueta ponta a ponta com
   um pedido de teste (?order=RC-...), sem precisar de uma compra de
   verdade. Só marca o pedido como pago se ele já não estiver.
   Remover depois de validar. */
async function handleMelhorEnvioTestCart(request, env) {
  try {
    const orderId = new URL(request.url).searchParams.get("order");
    if (!orderId) return jsonResponse({ error: "Passe ?order=ID do pedido de teste." }, 400);

    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { ...supaHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify({ payment_status: "pago" })
    });

    const logs = [];
    const originalLog = console.log, originalWarn = console.warn, originalError = console.error;
    console.log = (...a) => { logs.push(["log", ...a].join(" ")); originalLog(...a); };
    console.warn = (...a) => { logs.push(["warn", ...a].join(" ")); originalWarn(...a); };
    console.error = (...a) => { logs.push(["error", ...a].join(" ")); originalError(...a); };
    try {
      await createMelhorEnvioCartEntry(orderId, env);
    } finally {
      console.log = originalLog; console.warn = originalWarn; console.error = originalError;
    }

    return jsonResponse({ orderId, logs });
  } catch (err) {
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
  const [orderRes, settingsRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, { headers: supaHeaders(env) }),
    fetch(`${env.SUPABASE_URL}/rest/v1/shipping_settings?id=eq.1&select=*`, { headers: supaHeaders(env) })
  ]);
  if (!orderRes.ok || !settingsRes.ok) {
    console.error("Melhor Envio — falha ao buscar pedido/configurações:", await orderRes.text().catch(() => ""), await settingsRes.text().catch(() => ""));
    return;
  }
  const orders = await orderRes.json();
  const settingsRows = await settingsRes.json();
  const orderRow = orders[0];
  const settings = settingsRows[0];

  if (!orderRow) { console.error("Melhor Envio — pedido não encontrado:", orderId); return; }
  if (!settings) {
    console.warn("Melhor Envio — Configurações de Envio (medidas) não cadastradas ainda. Etiqueta não gerada para", orderId);
    return;
  }

  const order = { id: orderRow.id, total: orderRow.total, customer: orderRow.customer, items: orderRow.items };

  let accessToken;
  try {
    accessToken = await getMelhorEnvioAccessToken(env);
  } catch (err) {
    console.error("Melhor Envio — token indisponível:", err.message);
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
      return;
    }
  }

  if (!res.ok) {
    console.error("Melhor Envio — falha ao inserir no carrinho:", res.status, await res.text());
    return;
  }

  console.log("Melhor Envio — etiqueta inserida no carrinho com sucesso para", orderId);
}
