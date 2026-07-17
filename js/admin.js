/* =====================================================
   PAINEL DE CONTROLE (ADMIN) — rotas #admin-login e #admin-dashboard
   Depende de: CONFIG, money() (js/app.js) e getOrders()/saveOrders()
   (js/checkout.js).

   SEGURANÇA — dois modos (ver js/supabase-client.js e SUPABASE.md):
   - MODO NUVEM (Supabase configurado): login por e-mail/senha validado
     no servidor (Supabase Auth) e pedidos no banco com RLS — leitura
     exige sessão autenticada; isso É segurança real.
   - MODO LOCAL (Supabase vazio): senha conferida por hash SHA-256 no
     front-end e sessão em sessionStorage. É um OBSTÁCULO, não
     segurança real (contornável pelo DevTools); o risco é baixo porque
     os pedidos vivem no localStorage de cada navegador.

   Para trocar a senha: gere o novo hash executando no console
     crypto.subtle.digest("SHA-256", new TextEncoder().encode("SUA-SENHA"))
       .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("")))
   e cole o resultado em ADMIN_PASSWORD_HASH.
===================================================== */
const ADMIN_PASSWORD_HASH = "15116bf2bbce39ea573bd4d7e9e7631311bfecb5e3226abee48129c10d1d8fa8"; // senha padrão: recyber2021
const ADMIN_SESSION_KEY = "recyber_admin_session";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* Com Supabase configurado, "dono" = sessão autenticada no servidor. */
async function isOwner() {
  if (supabaseEnabled()) {
    const { data } = await sb.auth.getSession();
    return !!data.session;
  }
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === ADMIN_PASSWORD_HASH;
}

/* Cache dos pedidos carregados (nuvem ou local) para os handlers. */
let adminOrders = [];

async function loadOrders() {
  if (supabaseEnabled()) {
    let { data, error } = await sb.from("orders").select("*").eq("archived", false).order("created_at", { ascending: false });
    if (error && error.message && error.message.includes("archived")) {
      /* Coluna "archived" ainda não existe (Passo 13 do SUPABASE.md não
         rodado) — carrega tudo sem filtrar, em vez de quebrar a aba. */
      ({ data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false }));
    }
    if (error) {
      console.error("Supabase select:", error);
      showToast("Erro ao carregar os pedidos");
      return [];
    }
    return data.map(rowToOrder);
  }
  return getOrders().slice().reverse();
}

/* Evita mostrar "undefined" quando um pedido antigo/de teste não tem
   algum campo do cliente preenchido. */
function safe(value, fallback = "Não informado") {
  return value === undefined || value === null || value === "" ? fallback : value;
}

/* =====================================================
   STATUS
===================================================== */
const STATUS_LABELS = {
  recebido: "Recebido",
  "em-preparacao": "Em preparação",
  enviado: "Enviado"
};
const PAYMENT_STATUS = ["pendente", "pago", "cancelado"];
const PAYMENT_STATUS_LABELS = { pendente: "Pendente", pago: "Pago", cancelado: "Cancelado" };

/* =====================================================
   MENSAGENS DE WHATSAPP + E-MAIL (configuráveis pelo painel, aba
   "Texto WhatsApp e E-mail") — uma tela só pros dois canais. Cada
   status usa um prefixo de coluna na tabela email_templates:
   em-preparacao -> prep_, enviado -> shipped_, cancelado -> cancelled_
===================================================== */
const EMAIL_STATUS_PREFIX = { "em-preparacao": "prep", enviado: "shipped", cancelado: "cancelled", promo: "promo" };
const DEFAULT_MESSAGE_TEMPLATES = {
  "em-preparacao": {
    whatsapp: "Alerta de Garimpo: seu pedido já entrou no nosso laboratório de regeneração! 🧪✨\n\nOlá, {{nome}}! Nossos circuitos detectaram sua escolha sustentável (pedido {{pedido}}) e já estamos separando, higienizando e embalando suas peças com todo o carinho que o planeta merece. Assim que for enviado, você recebe o código de rastreio por aqui. Em breve ela ganha uma nova história com você! 💚",
    subject: "Re.cyber — Seu pedido está em preparação!",
    body: "Alerta de Garimpo: seu pedido já entrou no nosso laboratório de regeneração! 🧪✨\n\nOlá, {{nome}}! Nossos circuitos detectaram sua escolha sustentável (pedido {{pedido}}) e já estamos separando, higienizando e embalando suas peças com todo o carinho que o planeta merece. Assim que for enviado, você recebe o código de rastreio por aqui. Em breve ela ganha uma nova história com você! 💚",
    imageUrl: ""
  },
  enviado: {
    whatsapp: "Caixinha Re.cyber liberada para o espaço! 🛸📦\n\nBoas notícias, {{nome}}! Seu garimpo (pedido {{pedido}}) foi oficialmente postado e está a caminho da sua casa. O código de rastreamento chega em seguida por aqui para você acompanhar a viagem das suas novas peças. Prepare o guarda-roupa! ✨",
    subject: "Re.cyber — Seu pedido foi enviado!",
    body: "Caixinha Re.cyber liberada para o espaço! 🛸📦\n\nBoas notícias, {{nome}}! Seu garimpo (pedido {{pedido}}) foi oficialmente postado e está a caminho da sua casa. O código de rastreamento chega em seguida por aqui para você acompanhar a viagem das suas novas peças. Prepare o guarda-roupa! ✨",
    imageUrl: ""
  },
  cancelado: {
    whatsapp: "Olá {{nome}}! Seu pedido {{pedido}} no Re.cyber foi cancelado. Se já tiver feito o pagamento ou tiver alguma dúvida, é só responder por aqui que a gente resolve. 🙏",
    subject: "Re.cyber — Pedido cancelado",
    body: "Olá {{nome}}! Seu pedido {{pedido}} no Re.cyber foi cancelado. Se já tiver feito o pagamento ou tiver alguma dúvida, é só responder por aqui que a gente resolve. 🙏",
    imageUrl: ""
  },
  promo: {
    whatsapp: "Modo Promo ativado no Re.cyber! ⚡🟢\n\nOlá, {{nome}}! Nosso brechó entrou em modo promocional: peças selecionadas com desconto por tempo limitado. Corre porque cada peça é única e não volta! 💚",
    subject: "Re.cyber — Modo Promo ativado! ⚡",
    body: "Modo Promo ativado no Re.cyber! ⚡🟢\n\nOlá, {{nome}}! Nosso brechó entrou em modo promocional: peças selecionadas com desconto por tempo limitado. Corre porque cada peça é única e não volta! 💚",
    imageUrl: ""
  }
};
let emailTemplatesCache = null;

async function fetchEmailTemplates() {
  if (!supabaseEnabled()) return null;
  const { data, error } = await sb.from("email_templates").select("*").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) console.warn("Templates de mensagens indisponíveis:", error.message);
    return null;
  }
  return data;
}

function getMessageTemplate(status) {
  const prefix = EMAIL_STATUS_PREFIX[status];
  const row = emailTemplatesCache;
  const defaults = DEFAULT_MESSAGE_TEMPLATES[status];
  if (!row || !prefix) return defaults;
  /* Cada campo cai pro padrão criativo individualmente — deixar um
     campo em branco no painel não perde os outros já configurados. */
  return {
    whatsapp: row[`${prefix}_whatsapp`] || defaults.whatsapp,
    subject: row[`${prefix}_subject`] || defaults.subject,
    body: row[`${prefix}_body`] || defaults.body,
    imageUrl: row[`${prefix}_image_url`] || ""
  };
}

function fillTemplate(text, order) {
  return text.replace(/\{\{nome\}\}/g, order.customer.nome).replace(/\{\{pedido\}\}/g, order.id);
}

/* Template de e-mail minimalista preto e branco, no estilo do site. */
function buildEmailHtml(title, bodyText, imageUrl) {
  const paragraphs = bodyText.split("\n").filter(Boolean).map(p => `<p style="margin:0 0 14px;">${p}</p>`).join("");
  const imageHtml = imageUrl
    ? `<img src="${imageUrl}" alt="" style="width:100%;border-radius:8px;border:1.5px solid #161616;margin-bottom:20px;display:block;">`
    : "";
  return `
    <div style="background:#0e0e0e;padding:32px 16px;font-family:'Courier New',monospace;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border:2px solid #161616;border-radius:10px;padding:28px;">
        <p style="font-family:monospace;font-weight:bold;font-size:15px;letter-spacing:1px;margin:0 0 20px;">RE<span style="color:#2f8f4e;">.</span>CYBER</p>
        ${imageHtml}
        <h1 style="font-size:14px;letter-spacing:.5px;margin:0 0 16px;">${title}</h1>
        <div style="font-size:14px;line-height:1.6;color:#161616;">${paragraphs}</div>
        <hr style="border:none;border-top:1px solid #dededd;margin:24px 0 16px;">
        <p style="font-size:11px;color:#8a8a86;margin:0;">Re.cyber — Slow Fashion Brechó · recyber.com.br</p>
      </div>
    </div>`;
}

/* Envia o e-mail de verdade via Resend (rota /api/send-email do
   worker.js). Se falhar (secret não configurado, Resend fora do ar,
   etc.), avisa no toast em vez de travar o resto da notificação. */
async function sendOrderEmail(order, subject, text, imageUrl) {
  if (!order.customer.email) return;
  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: order.customer.email, subject, html: buildEmailHtml(subject, text, imageUrl) })
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    showToast("E-mail de notificação enviado com sucesso!");
  } catch (err) {
    console.error("Envio de e-mail:", err);
    showToast("Não foi possível enviar o e-mail automaticamente.");
  }
}

/* WhatsApp (wa.me) abre com o texto configurável já pronto — o
   administrador confirma o envio no app (não dá pra automatizar o
   clique de enviar sem a API paga do WhatsApp Business). O e-mail usa
   o mesmo template (assunto + corpo + imagem), enviado de verdade via
   Resend (Passo 14 do SUPABASE.md). Os dois ficam configuráveis juntos
   na aba "Texto WhatsApp e E-mail" (Passo 15/16 do SUPABASE.md). */
function notifyCustomerBothChannels(order, status) {
  const tpl = getMessageTemplate(status);
  const phone = (order.customer.telefone || "").replace(/\D/g, "");
  if (!phone) {
    showToast("Esse pedido não tem WhatsApp cadastrado — enviando só o e-mail.");
  } else {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(fillTemplate(tpl.whatsapp, order))}`, "_blank");
  }

  sendOrderEmail(order, fillTemplate(tpl.subject, order), fillTemplate(tpl.body, order), tpl.imageUrl);
}

async function updateOrder(orderId, patch) {
  if (supabaseEnabled()) {
    const row = {};
    if (patch.status) row.status = patch.status;
    if (patch.paymentStatus) row.payment_status = patch.paymentStatus;
    const { error } = await sb.from("orders").update(row).eq("id", orderId);
    if (error) {
      console.error("Supabase update:", error);
      showToast("Erro ao atualizar o pedido");
    }
  } else {
    const orders = getOrders();
    const order = orders.find(o => o.id === orderId);
    if (order) Object.assign(order, patch);
    saveOrders(orders);
  }
  renderAdmin();
}

/* Botão único: abre WhatsApp + e-mail juntos com a mesma mensagem. */
function triggerStatusNotification(orderId, status) {
  const order = adminOrders.find(o => o.id === orderId);
  if (!order) return;
  notifyCustomerBothChannels(order, status);
  updateOrder(orderId, { status });
}

/* =====================================================
   ABA: PEDIDOS / PAGAMENTOS
===================================================== */
/* Miniatura da peça. Prioriza a foto salva no próprio pedido (item.image
   — a peça como ela era no momento da compra). Pedidos antigos, salvos
   antes dessa mudança, não têm esse campo: nesse caso cai para o
   catálogo público em memória (PRODUCTS, via js/catalog-sync.js) pelo
   id, que falha graciosamente se a peça foi editada/removida depois
   ou se o catálogo ainda não carregou. */
function productThumbHtml(item) {
  const fallback = typeof PRODUCTS !== "undefined" ? PRODUCTS.find(pr => pr.id === item.id) : null;
  const img = item.image || (fallback && fallback.image);
  if (!img) return `<span class="order-item-thumb order-item-thumb--empty" aria-hidden="true"></span>`;
  return `<img class="order-item-thumb" src="${img}" alt="${item.name}" loading="lazy" onerror="this.outerHTML='&lt;span class=&quot;order-item-thumb order-item-thumb--empty&quot; aria-hidden=&quot;true&quot;&gt;&lt;/span&gt;'">`;
}

function orderCardHtml(order) {
  const date = new Date(order.createdAt).toLocaleString("pt-BR");
  const thumbsHtml = order.items.map(i => productThumbHtml(i)).join("");
  const itemsHtml = order.items.map(i => `<li>${i.qty}x ${i.name} (Tam. ${i.size}) — ${money(i.price * i.qty)}</li>`).join("");
  const paymentLabel = order.payment === "pix" ? "Pix" : "Cartão de Crédito";
  const payStatus = order.paymentStatus || "pendente";
  const payOptions = PAYMENT_STATUS.map(s =>
    `<option value="${s}" ${s === payStatus ? "selected" : ""}>${PAYMENT_STATUS_LABELS[s]}</option>`
  ).join("");

  return `
    <div class="order-card">
      <div class="order-card-head">
        <span class="order-id">${order.id}</span>
        <div class="order-card-head-right">
          <span class="order-status order-status--${order.status}" ${payStatus === "cancelado" ? "hidden" : ""}>${STATUS_LABELS[order.status] || order.status}</span>
          <button type="button" class="order-remove-btn" data-order="${order.id}" title="Remover Pedido" aria-label="Remover Pedido">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <span class="order-date">${date}</span>

      <div class="order-card-grid">
        <div class="order-block order-block--panel">
          <h4>Cliente</h4>
          <p>${safe(order.customer.nome)}</p>
          <p>${safe(order.customer.email)} · ${safe(order.customer.telefone)}</p>
          <p>CPF: ${safe(order.customer.cpf)}</p>
          <div class="order-block-divider"></div>
          <h4>Endereço</h4>
          <p>${safe(order.customer.logradouro)}, ${safe(order.customer.numero, "-")}${order.customer.complemento ? ` — ${order.customer.complemento}` : ""}</p>
          <p>${safe(order.customer.bairro)} · CEP ${safe(order.customer.cep)}</p>
        </div>

        <div class="order-block order-block--panel order-block--payment">
          <h4>Pagamento</h4>
          <p>${paymentLabel}</p>
          <p>Subtotal: ${money(order.subtotal)}</p>
          <p>Frete: ${money(order.shipping)}</p>
          <p class="order-total-final">Total: ${money(order.total)}</p>
          <label class="order-payment-status-label">
            <span>Status do pagamento</span>
            <select class="sort-select pay-status-select pay-status--${payStatus}" data-order="${order.id}">${payOptions}</select>
          </label>
        </div>
      </div>

      <div class="order-block order-block--panel">
        <h4>Peças (${order.items.reduce((n, i) => n + i.qty, 0)})</h4>
        <div class="order-item-thumbs">${thumbsHtml}</div>
        <ul class="order-items">${itemsHtml}</ul>
      </div>

      <div class="order-actions" ${payStatus === "cancelado" ? "hidden" : ""}>
        <button type="button" class="pill pill-sm" data-order="${order.id}" data-status="em-preparacao">Notificar Início de Preparação</button>
        <button type="button" class="pill pill-sm" data-order="${order.id}" data-status="enviado">Notificar Envio do Pedido</button>
      </div>
    </div>
  `;
}

/* =====================================================
   ABA: CONTROLE DE MARKETING — lista unificada (clientes com
   marketing autorizado no checkout + inscritos ativos da newsletter,
   SUPABASE.md Passo 18/19), sem duplicar quem está nas duas listas
   (dedup por e-mail em minúsculas) + EXPORTAÇÃO CSV.
===================================================== */
let adminNewsletterSubscribers = [];

async function loadNewsletterSubscribers() {
  if (!supabaseEnabled()) return [];
  const { data, error } = await sb.from("newsletter_subscribers").select("*").eq("active", true);
  if (error) {
    console.warn("Newsletter (painel):", error.message);
    return [];
  }
  return data;
}

/* Une as duas fontes por e-mail (minúsculo) — quem está nas duas
   ganha origem "Cliente + Newsletter" e aparece uma vez só. */
function buildUnifiedLeadList(orders, subscribers) {
  const map = new Map();
  orders.forEach(o => {
    if (!o.marketingOptIn || !o.customer.email) return;
    const key = o.customer.email.trim().toLowerCase();
    const existing = map.get(key);
    map.set(key, {
      email: o.customer.email.trim(),
      telefone: o.customer.telefone || (existing ? existing.telefone : ""),
      origins: new Set([...(existing ? existing.origins : []), "Cliente"]),
      newsletterId: existing ? existing.newsletterId : null
    });
  });
  subscribers.forEach(s => {
    if (!s.email) return;
    const key = s.email.trim().toLowerCase();
    const existing = map.get(key);
    map.set(key, {
      email: s.email.trim(),
      telefone: existing ? existing.telefone : "",
      origins: new Set([...(existing ? existing.origins : []), "Newsletter"]),
      newsletterId: s.id
    });
  });
  return [...map.values()];
}

async function renderLeads(orders) {
  adminNewsletterSubscribers = await loadNewsletterSubscribers();
  const unified = buildUnifiedLeadList(orders, adminNewsletterSubscribers);

  document.getElementById("admin-metric-newsletter").textContent = adminNewsletterSubscribers.length;
  document.getElementById("admin-metric-clientes").textContent =
    orders.filter(o => o.marketingOptIn && o.customer.email).length;
  document.getElementById("admin-metric-unificada").textContent = unified.length;

  const rows = unified.map(lead => `
    <tr>
      <td data-label="E-mail">${lead.email}</td>
      <td data-label="WhatsApp">${lead.telefone || "—"}</td>
      <td data-label="Origem">${[...lead.origins].join(" + ")}</td>
      <td data-label="Status de Marketing"><span class="lead-status lead-status--inscrito">Inscrito</span></td>
      <td data-label="Ação">${lead.newsletterId
        ? `<button type="button" class="lead-remove-btn" data-newsletter-id="${lead.newsletterId}">Remover</button>`
        : "—"}</td>
    </tr>
  `).join("");
  document.getElementById("admin-leads-body").innerHTML = rows;
  document.getElementById("admin-leads-empty").hidden = unified.length !== 0;
  document.querySelector(".admin-leads-table-wrap").hidden = unified.length === 0;
}

document.getElementById("admin-leads-body").addEventListener("click", async e => {
  const btn = e.target.closest(".lead-remove-btn");
  if (!btn || !supabaseEnabled()) return;
  btn.disabled = true;
  btn.textContent = "Removendo...";
  const { error } = await sb.from("newsletter_subscribers")
    .update({ active: false })
    .eq("id", btn.dataset.newsletterId);
  if (error) {
    console.error("Remover inscrito:", error);
    showToast("Erro ao remover da lista");
    btn.disabled = false;
    btn.textContent = "Remover";
    return;
  }
  showToast("Removido da lista de marketing");
  renderLeads(adminOrders);
});

function exportLeadsCsv() {
  const unified = buildUnifiedLeadList(adminOrders, adminNewsletterSubscribers);
  if (unified.length === 0) {
    showToast("Nenhum lead para exportar");
    return;
  }
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ["E-mail", "WhatsApp", "Origem"].join(","),
    ...unified.map(lead => [
      esc(lead.email),
      esc(lead.telefone || ""),
      esc([...lead.origins].join(" + "))
    ].join(","))
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "recyber-leads.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* =====================================================
   RENDER GERAL + ABAS
===================================================== */
async function renderAdmin() {
  const orders = await loadOrders();
  adminOrders = orders;
  document.getElementById("admin-count").textContent = `${orders.length} pedido${orders.length === 1 ? "" : "s"}`;
  document.getElementById("admin-orders").innerHTML = orders.map(orderCardHtml).join("");
  document.getElementById("admin-empty").hidden = orders.length !== 0;
  await renderLeads(orders);
}

document.getElementById("admin-tabs").addEventListener("click", e => {
  const pill = e.target.closest("[data-tab]");
  if (!pill) return;
  document.querySelectorAll("#admin-tabs .pill").forEach(p => p.classList.toggle("active", p === pill));
  ["leads", "pedidos", "cadastro", "feedbacks", "textos", "promo"].forEach(tab => {
    document.getElementById(`admin-tab-${tab}`).hidden = tab !== pill.dataset.tab;
  });

  /* Atalho "📦 Configurações de Envio": além de trocar pra aba
     "Promoção e Desconto", rola até a seção específica. */
  if (pill.id === "admin-shipping-settings-open") {
    document.getElementById("admin-shipping-settings-section")
      .scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

/* Arquiva (soft delete) o pedido: some do painel, mas o registro
   continua no banco para não perder histórico de faturamento. */
async function archiveOrder(orderId, cardEl) {
  if (!confirm("Tem certeza que deseja remover este pedido do painel de monitoramento?")) return;

  if (supabaseEnabled()) {
    const { error } = await sb.from("orders").update({ archived: true }).eq("id", orderId);
    if (error) {
      console.error("Arquivar pedido:", error);
      showToast(describeSupabaseFormError(error, { table: "orders", step: "Passo 13" }));
      return;
    }
  } else {
    saveOrders(getOrders().filter(o => o.id !== orderId));
  }

  showToast("Pedido removido do painel");
  adminOrders = adminOrders.filter(o => o.id !== orderId);
  if (cardEl) {
    cardEl.classList.add("is-removing");
    setTimeout(() => cardEl.remove(), 250);
  }
}

document.getElementById("admin-orders").addEventListener("click", e => {
  const removeBtn = e.target.closest(".order-remove-btn");
  if (removeBtn) {
    archiveOrder(removeBtn.dataset.order, removeBtn.closest(".order-card"));
    return;
  }

  const btn = e.target.closest("button[data-order]");
  if (!btn) return;
  triggerStatusNotification(btn.dataset.order, btn.dataset.status);
});
document.getElementById("admin-orders").addEventListener("change", e => {
  const sel = e.target.closest(".pay-status-select");
  if (!sel) return;
  const newStatus = sel.value;

  /* Esconde/mostra os botões de logística e a etiqueta de status
     (ENVIADO/EM PREPARAÇÃO) na hora, sem esperar o update assíncrono
     terminar (evita notificar por engano um pedido que acabou de ser
     cancelado, e ambos reaparecem se o status voltar). */
  const card = sel.closest(".order-card");
  const actions = card?.querySelector(".order-actions");
  const statusBadge = card?.querySelector(".order-status");
  if (actions) actions.hidden = newStatus === "cancelado";
  if (statusBadge) statusBadge.hidden = newStatus === "cancelado";

  /* Abre as notificações ANTES do update assíncrono — se esperarmos a
     resposta do Supabase primeiro, alguns navegadores tratam o
     window.open() como fora do gesto do usuário e bloqueiam o popup. */
  if (newStatus === "cancelado") {
    const order = adminOrders.find(o => o.id === sel.dataset.order);
    if (order) notifyCustomerBothChannels(order, "cancelado");
  }
  updateOrder(sel.dataset.order, { paymentStatus: newStatus });
});

document.getElementById("admin-export-csv").addEventListener("click", exportLeadsCsv);

/* =====================================================
   LOGIN + GUARDA DE ROTA
===================================================== */
document.getElementById("admin-login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const input = document.getElementById("admin-password");
  const errorEl = document.getElementById("admin-login-error");

  if (supabaseEnabled()) {
    const email = document.getElementById("admin-email").value.trim();
    const { error } = await sb.auth.signInWithPassword({ email, password: input.value });
    if (error) {
      errorEl.textContent = "Acesso Negado: Credenciais Inválidas";
      errorEl.hidden = false;
      return;
    }
    input.value = "";
    errorEl.hidden = true;
    window.location.hash = "#admin-dashboard";
    return;
  }

  const hash = await sha256Hex(input.value);
  if (hash === ADMIN_PASSWORD_HASH) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, hash);
    input.value = "";
    errorEl.hidden = true;
    window.location.hash = "#admin-dashboard";
  } else {
    errorEl.hidden = false;
  }
});

document.getElementById("admin-logout").addEventListener("click", async () => {
  if (supabaseEnabled()) await sb.auth.signOut();
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  window.location.hash = "#catalogo";
});
document.getElementById("admin-login-back").addEventListener("click", () => {
  window.location.hash = "#catalogo";
});
document.getElementById("admin-close").addEventListener("click", () => {
  window.location.hash = "#catalogo";
});

function showAdminPanel() {
  renderAdmin();
  setupProductForm();
  setupFeedbackForm();
  setupSettingsForm();
  setupEmailTemplatesForm();
  setupPromoForm();
  setupCartDiscountForm();
  setupShippingSettingsForm();
  document.getElementById("admin-login").hidden = true;
  document.getElementById("admin-panel").hidden = false;
  document.body.classList.add("admin-open");
}
function showAdminLogin() {
  document.getElementById("admin-panel").hidden = true;
  document.getElementById("admin-login").hidden = false;
  document.body.classList.add("admin-open");
  // Com Supabase, o login é por e-mail + senha (validado no servidor)
  const emailField = document.getElementById("admin-email-field");
  emailField.hidden = !supabaseEnabled();
  document.getElementById("admin-email").required = supabaseEnabled();
  document.getElementById(supabaseEnabled() ? "admin-email" : "admin-password").focus();
}
function hideAdminViews() {
  document.getElementById("admin-panel").hidden = true;
  document.getElementById("admin-login").hidden = true;
  document.body.classList.remove("admin-open");
}

/* Guarda de rota: #admin-dashboard exige sessão de dono ativa.
   Acesso direto sem sessão válida NÃO revela a tela de login — volta
   silenciosamente para a home pública. A tela de login só aparece via
   #admin-login (gatilho secreto ou digitação direta), mantendo o
   painel discreto para quem não conhece o caminho. */
async function syncAdminRoute() {
  const hash = window.location.hash;
  if (hash === "#admin-dashboard" || hash === "#painel-admin") {
    if (await isOwner()) {
      showAdminPanel();
    } else {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      hideAdminViews();
      window.location.hash = "#catalogo"; // redireciona silenciosamente
    }
  } else if (hash === "#admin-login") {
    if (await isOwner()) window.location.hash = "#admin-dashboard";
    else showAdminLogin();
  } else {
    hideAdminViews();
  }
}

window.addEventListener("hashchange", syncAdminRoute);
syncAdminRoute();

/* =====================================================
   CADASTRO DE PEÇA (aba "Cadastro de Peça")
   Sobe a foto para o Storage (bucket product-images) e insere a linha
   na tabela public.products — a peça aparece no catálogo público na
   próxima sincronização (js/catalog-sync.js).
===================================================== */
function setupProductForm() {
  const select = document.getElementById("pf-category");
  if (select && !select.dataset.filled) {
    select.innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
    select.dataset.filled = "1";
  }

  const unavailable = document.getElementById("product-form-unavailable");
  const submitBtn = document.getElementById("product-form-submit");
  if (!supabaseEnabled()) {
    unavailable.hidden = false;
    unavailable.textContent = "Cadastro indisponível: configure o Supabase (veja SUPABASE.md).";
    submitBtn.disabled = true;
  } else {
    unavailable.hidden = true;
    submitBtn.disabled = false;
  }
}

/* Fotos selecionadas ficam nesta lista (não no <input>) para permitir
   remover uma a uma e ir acumulando várias seleções. */
let selectedProductImages = [];

function renderProductImagePreviews() {
  const wrap = document.getElementById("pf-image-previews");
  wrap.innerHTML = selectedProductImages.map((file, i) => `
    <div class="pf-image-thumb">
      <img src="${URL.createObjectURL(file)}" alt="${file.name}">
      <button type="button" class="pf-image-remove" data-index="${i}" aria-label="Remover foto">&times;</button>
    </div>
  `).join("");
}

document.getElementById("pf-image").addEventListener("change", e => {
  selectedProductImages.push(...e.target.files);
  e.target.value = ""; // limpa o input para poder escolher mais fotos depois
  renderProductImagePreviews();
});

document.getElementById("pf-image-previews").addEventListener("click", e => {
  const btn = e.target.closest(".pf-image-remove");
  if (!btn) return;
  selectedProductImages.splice(Number(btn.dataset.index), 1);
  renderProductImagePreviews();
});

function resetProductForm() {
  document.getElementById("product-form").reset();
  selectedProductImages = [];
  renderProductImagePreviews();
}

/* Traduz erros comuns do Supabase para mensagens acionáveis.
   opts: { table: "products"|"feedbacks", step: "Passo 5"|"Passo 6" } */
function describeSupabaseFormError(err, opts) {
  const table = opts && opts.table || "products";
  const step = opts && opts.step || "Passo 5";
  const msg = err && err.message ? err.message : "";
  const extra = [err.code, err.details, err.hint].filter(Boolean).join(" · ");
  const stepLabel = err.step === "upload" ? "no envio da FOTO" : err.step === "insert" ? "ao SALVAR o registro" : "";

  if (err.code === "PGRST205" || msg.includes("Could not find the table")) {
    return `A tabela "${table}" ainda não existe no Supabase. Rode o SQL do ${step} em SUPABASE.md.`;
  }
  if (msg.includes("Bucket not found")) {
    return `O bucket de fotos "product-images" ainda não existe no Supabase. Crie-o no Passo 5 de SUPABASE.md.`;
  }
  if (msg.includes("row-level security") || msg.includes("permission denied")) {
    if (err.step === "upload") {
      return `Sem permissão para ENVIAR FOTO — as políticas de segurança do bucket "product-images" (Passo 5, bloco de Storage em SUPABASE.md) não foram aplicadas ainda. Rode aquele SQL de novo.`;
    }
    return `Sem permissão ${stepLabel} (sessão pode ter expirado — saia e entre de novo). Detalhe técnico: ${extra || msg}`;
  }
  return `Erro ${stepLabel || "ao cadastrar"}: ${msg || "tente novamente."}${extra ? ` (${extra})` : ""}`;
}

function describeProductFormError(err) {
  return describeSupabaseFormError(err, { table: "products", step: "Passo 5" });
}

document.getElementById("product-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const submitBtn = document.getElementById("product-form-submit");
  const unavailable = document.getElementById("product-form-unavailable");

  submitBtn.disabled = true;
  submitBtn.textContent = "Cadastrando...";
  unavailable.hidden = true;

  try {
    const { data: sessionData } = await sb.auth.getSession();
    console.log("Sessão no momento do envio:", sessionData.session ? {
      userId: sessionData.session.user.id,
      email: sessionData.session.user.email,
      role: sessionData.session.user.role,
      expiresAt: new Date(sessionData.session.expires_at * 1000).toISOString()
    } : "NENHUMA SESSÃO ATIVA");
    if (!sessionData.session) {
      throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");
    }

    const imageUrls = [];
    for (const file of selectedProductImages) {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error: uploadError } = await sb.storage.from("product-images").upload(path, file);
      if (uploadError) { uploadError.step = "upload"; throw uploadError; }
      imageUrls.push(sb.storage.from("product-images").getPublicUrl(path).data.publicUrl);
    }

    const { error: insertError } = await sb.from("products").insert({
      name: document.getElementById("pf-name").value.trim(),
      price: Number(document.getElementById("pf-price").value) || 0,
      size: document.getElementById("pf-size").value.trim(),
      category: document.getElementById("pf-category").value,
      description: document.getElementById("pf-description").value.trim(),
      image_urls: imageUrls,
      tag: "novo"
    });
    if (insertError) { insertError.step = "insert"; throw insertError; }

    resetProductForm();
    showToast("Peça cadastrada com sucesso");
    if (typeof syncCatalog === "function") syncCatalog();
  } catch (err) {
    console.error("Cadastro de peça:", err);
    unavailable.hidden = false;
    unavailable.textContent = describeProductFormError(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Cadastrar Peça";
  }
});

/* =====================================================
   GERENCIAR FEEDBACKS (aba "Feedbacks")
   Sobe a foto (opcional) para o bucket product-images e insere a
   linha na tabela public.feedbacks — o depoimento aparece na home
   (js/feedback-sync.js) na próxima sincronização.
===================================================== */
let selectedFeedbackImage = null;

function setupFeedbackForm() {
  const unavailable = document.getElementById("feedback-form-unavailable");
  const submitBtn = document.getElementById("feedback-form-submit");
  if (!supabaseEnabled()) {
    unavailable.hidden = false;
    unavailable.textContent = "Cadastro indisponível: configure o Supabase (veja SUPABASE.md).";
    submitBtn.disabled = true;
  } else {
    unavailable.hidden = true;
    submitBtn.disabled = false;
  }
  renderFeedbacksList();
}

/* Lista "Feedbacks ativos" (aba Feedbacks) com botão de apagar. */
async function renderFeedbacksList() {
  const list = document.getElementById("admin-feedbacks-list");
  const empty = document.getElementById("admin-feedbacks-empty");
  if (!supabaseEnabled()) {
    list.innerHTML = "";
    empty.hidden = true;
    return;
  }
  const { data, error } = await sb.from("feedbacks").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("Listar feedbacks:", error);
    list.innerHTML = "";
    empty.hidden = true;
    return;
  }
  const feedbacks = data.map(rowToFeedback);
  empty.hidden = feedbacks.length !== 0;
  list.innerHTML = feedbacks.map(f => {
    const stars = "★".repeat(f.rating) + "☆".repeat(5 - f.rating);
    const photoHtml = f.photo ? `<img class="admin-feedback-photo" src="${f.photo}" alt="Foto de ${f.name}">` : "";
    return `
      <div class="admin-feedback-item" data-feedback-id="${f.id}">
        ${photoHtml}
        <div class="admin-feedback-body">
          <span class="admin-feedback-name">${f.name}</span>
          <span class="admin-feedback-stars">${stars}</span>
          <p class="admin-feedback-text">${f.comment}</p>
        </div>
        <button type="button" class="admin-feedback-delete" data-feedback-id="${f.id}">Apagar</button>
      </div>
    `;
  }).join("");
}

document.getElementById("admin-feedbacks-list").addEventListener("click", async e => {
  const btn = e.target.closest(".admin-feedback-delete");
  if (!btn) return;
  if (!confirm("Tem certeza que deseja excluir permanentemente este feedback?")) return;

  const id = btn.dataset.feedbackId;
  const item = btn.closest(".admin-feedback-item");
  btn.disabled = true;

  const { error } = await sb.from("feedbacks").delete().eq("id", id);
  if (error) {
    console.error("Apagar feedback:", error);
    showToast("Erro ao apagar o feedback");
    btn.disabled = false;
    return;
  }

  item.classList.add("is-removing");
  setTimeout(() => item.remove(), 250);
  showToast("Feedback apagado");
  if (typeof syncFeedbacks === "function") syncFeedbacks();
});

function renderFeedbackImagePreview() {
  const wrap = document.getElementById("fb-image-previews");
  wrap.innerHTML = !selectedFeedbackImage ? "" : `
    <div class="pf-image-thumb">
      <img src="${URL.createObjectURL(selectedFeedbackImage)}" alt="${selectedFeedbackImage.name}">
      <button type="button" class="pf-image-remove" id="fb-image-remove" aria-label="Remover foto">&times;</button>
    </div>
  `;
}

document.getElementById("fb-image").addEventListener("change", e => {
  selectedFeedbackImage = e.target.files[0] || null;
  e.target.value = "";
  renderFeedbackImagePreview();
});
document.getElementById("fb-image-previews").addEventListener("click", e => {
  if (!e.target.closest("#fb-image-remove")) return;
  selectedFeedbackImage = null;
  renderFeedbackImagePreview();
});

function resetFeedbackForm() {
  document.getElementById("feedback-form").reset();
  selectedFeedbackImage = null;
  renderFeedbackImagePreview();
}

document.getElementById("feedback-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const submitBtn = document.getElementById("feedback-form-submit");
  const unavailable = document.getElementById("feedback-form-unavailable");

  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";
  unavailable.hidden = true;

  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) {
      throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");
    }

    let photoUrl = "";
    if (selectedFeedbackImage) {
      const path = `feedback-${Date.now()}-${selectedFeedbackImage.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error: uploadError } = await sb.storage.from("product-images").upload(path, selectedFeedbackImage);
      if (uploadError) { uploadError.step = "upload"; throw uploadError; }
      photoUrl = sb.storage.from("product-images").getPublicUrl(path).data.publicUrl;
    }

    const { error: insertError } = await sb.from("feedbacks").insert({
      name: document.getElementById("fb-name").value.trim(),
      comment: document.getElementById("fb-comment").value.trim(),
      rating: Number(document.getElementById("fb-rating").value) || 5,
      photo_url: photoUrl
    });
    if (insertError) { insertError.step = "insert"; throw insertError; }

    resetFeedbackForm();
    showToast("Feedback salvo com sucesso");
    renderFeedbacksList();
    if (typeof syncFeedbacks === "function") syncFeedbacks();
  } catch (err) {
    console.error("Cadastro de feedback:", err);
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(err, { table: "feedbacks", step: "Passo 6" });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar Feedback";
  }
});

/* =====================================================
   TEXTOS DO MODAL (aba "Textos do Modal")
   Carrega os textos atuais nos textareas e salva de volta na tabela
   public.site_settings (linha única, id=1) — o modal público
   (js/settings-sync.js) reflete a mudança na próxima sincronização.
===================================================== */
async function setupSettingsForm() {
  const unavailable = document.getElementById("settings-form-unavailable");
  const submitBtn = document.getElementById("settings-form-submit");
  if (!supabaseEnabled()) {
    unavailable.hidden = false;
    unavailable.textContent = "Edição indisponível: configure o Supabase (veja SUPABASE.md).";
    submitBtn.disabled = true;
    return;
  }
  unavailable.hidden = true;
  submitBtn.disabled = false;

  const settings = typeof fetchSiteSettings === "function" ? await fetchSiteSettings() : null;
  if (settings) {
    document.getElementById("st-envios").value = settings.envios;
    document.getElementById("st-pagamentos").value = settings.pagamentos;
    document.getElementById("st-devolucao").value = settings.devolucao;
    document.getElementById("st-instagram").value = settings.instagram;
    document.getElementById("st-tiktok").value = settings.tiktok;
    document.getElementById("st-tiktok-video").value = settings.tiktokVideoUrl;
  }
}

document.getElementById("settings-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const submitBtn = document.getElementById("settings-form-submit");
  const unavailable = document.getElementById("settings-form-unavailable");

  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";
  unavailable.hidden = true;

  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) {
      throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");
    }

    const { error: updateError } = await sb.from("site_settings").update({
      envios_text: document.getElementById("st-envios").value.trim(),
      pagamentos_text: document.getElementById("st-pagamentos").value.trim(),
      devolucao_text: document.getElementById("st-devolucao").value.trim(),
      instagram_link: document.getElementById("st-instagram").value.trim(),
      tiktok_link: document.getElementById("st-tiktok").value.trim(),
      tiktok_video_url: document.getElementById("st-tiktok-video").value.trim(),
      updated_at: new Date().toISOString()
    }).eq("id", 1);
    if (updateError) { updateError.step = "insert"; throw updateError; }

    showToast("Textos salvos com sucesso");
    if (typeof syncSiteSettings === "function") syncSiteSettings();
  } catch (err) {
    console.error("Textos do modal:", err);
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(err, { table: "site_settings", step: "Passo 7" });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar Textos";
  }
});

/* =====================================================
   TEXTO WHATSAPP E E-MAIL (aba "Textos do Modal")
   Salva WhatsApp + assunto/corpo/imagem de e-mail de cada status na
   tabela pública email_templates (linha única, id=1) — lida por
   getMessageTemplate() no momento de disparar a notificação de um
   pedido.
===================================================== */
const EMAIL_TEMPLATE_KEYS = ["prep", "shipped", "cancelled", "promo"];
const EMAIL_PREFIX_TO_STATUS = { prep: "em-preparacao", shipped: "enviado", cancelled: "cancelado", promo: "promo" };
let selectedEmailTemplateImages = { prep: null, shipped: null, cancelled: null, promo: null };

function renderEmailTemplateImagePreview(key) {
  const wrap = document.getElementById(`et-${key}-image-preview`);
  const file = selectedEmailTemplateImages[key];
  wrap.innerHTML = !file ? "" : `
    <div class="pf-image-thumb">
      <img src="${URL.createObjectURL(file)}" alt="${file.name}">
      <button type="button" class="pf-image-remove" data-key="${key}" aria-label="Remover foto">&times;</button>
    </div>
  `;
}
EMAIL_TEMPLATE_KEYS.forEach(key => {
  document.getElementById(`et-${key}-image`).addEventListener("change", e => {
    selectedEmailTemplateImages[key] = e.target.files[0] || null;
    e.target.value = "";
    renderEmailTemplateImagePreview(key);
  });
  document.getElementById(`et-${key}-image-preview`).addEventListener("click", e => {
    if (!e.target.closest(".pf-image-remove")) return;
    selectedEmailTemplateImages[key] = null;
    renderEmailTemplateImagePreview(key);
  });
});

async function setupEmailTemplatesForm() {
  const unavailable = document.getElementById("email-templates-form-unavailable");
  const submitBtn = document.getElementById("email-templates-form-submit");
  if (!supabaseEnabled()) {
    unavailable.hidden = false;
    unavailable.textContent = "Edição indisponível: configure o Supabase (veja SUPABASE.md).";
    submitBtn.disabled = true;
    return;
  }
  unavailable.hidden = true;
  submitBtn.disabled = false;

  emailTemplatesCache = await fetchEmailTemplates();
  EMAIL_TEMPLATE_KEYS.forEach(key => {
    const tpl = getMessageTemplate(EMAIL_PREFIX_TO_STATUS[key]);
    document.getElementById(`et-${key}-whatsapp`).value = tpl.whatsapp;
    document.getElementById(`et-${key}-subject`).value = tpl.subject;
    document.getElementById(`et-${key}-body`).value = tpl.body;
  });
}

document.getElementById("email-templates-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const submitBtn = document.getElementById("email-templates-form-submit");
  const unavailable = document.getElementById("email-templates-form-unavailable");
  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";
  unavailable.hidden = true;

  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");

    const payload = { updated_at: new Date().toISOString() };
    for (const key of EMAIL_TEMPLATE_KEYS) {
      payload[`${key}_whatsapp`] = document.getElementById(`et-${key}-whatsapp`).value.trim();
      payload[`${key}_subject`] = document.getElementById(`et-${key}-subject`).value.trim();
      payload[`${key}_body`] = document.getElementById(`et-${key}-body`).value.trim();

      const file = selectedEmailTemplateImages[key];
      if (file) {
        const path = `email-${key}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
        const { error: uploadError } = await sb.storage.from("spoilers").upload(path, file);
        if (uploadError) { uploadError.step = "upload"; throw uploadError; }
        payload[`${key}_image_url`] = sb.storage.from("spoilers").getPublicUrl(path).data.publicUrl;
      }
    }

    const { error } = await sb.from("email_templates").update(payload).eq("id", 1);
    if (error) { error.step = "insert"; throw error; }

    showToast("Mensagens salvas com sucesso");
    emailTemplatesCache = await fetchEmailTemplates();
    EMAIL_TEMPLATE_KEYS.forEach(key => {
      selectedEmailTemplateImages[key] = null;
      renderEmailTemplateImagePreview(key);
    });
  } catch (err) {
    console.error("Mensagens de e-mail:", err);
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(err, { table: "email_templates", step: "Passo 15" });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar Mensagens";
  }
});

/* =====================================================
   CAMPANHA DE DESCONTO (aba "Promoções")
   Salva na tabela public.promo_settings (linha única, id=1) e no
   campo is_promo de cada peça (tabela public.products) — o site
   público (js/promo-sync.js) reflete a mudança na próxima sincronização.
===================================================== */

/* "2026-07-20T00:00:00+00:00" (banco) <-> "2026-07-20T00:00" (input datetime-local, hora local) */
function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromDatetimeLocalValue(value) {
  return value ? new Date(value).toISOString() : null;
}

async function setupPromoForm() {
  const unavailable = document.getElementById("promo-form-unavailable");
  const submitBtn = document.getElementById("promo-form-submit");
  if (!supabaseEnabled()) {
    unavailable.hidden = false;
    unavailable.textContent = "Edição indisponível: configure o Supabase (veja SUPABASE.md).";
    submitBtn.disabled = true;
  } else {
    unavailable.hidden = true;
    submitBtn.disabled = false;

    const { data, error } = await sb.from("promo_settings").select("*").eq("id", 1).maybeSingle();
    if (!error && data) {
      const settings = rowToPromoSettings(data);
      document.getElementById("promo-active").checked = settings.active;
      document.getElementById("promo-discount").value = settings.discountPercent;
      document.getElementById("promo-start").value = toDatetimeLocalValue(settings.startDate);
      document.getElementById("promo-end").value = toDatetimeLocalValue(settings.endDate);
    } else if (error) {
      unavailable.hidden = false;
      unavailable.textContent = describeSupabaseFormError(error, { table: "promo_settings", step: "Passo 9" });
      submitBtn.disabled = true;
    }
  }
  renderPromoProductsList();
  refreshPromoQuickStatus();
}

/* Botão destacado "Ativar/Desativar Modo Promo" — atalho de um clique
   que liga/desliga a campanha sem precisar abrir e salvar o form
   inteiro (os campos de desconto/datas continuam os últimos salvos). */
async function refreshPromoQuickStatus() {
  const statusEl = document.getElementById("promo-quick-status");
  const btn = document.getElementById("promo-quick-toggle");
  if (!supabaseEnabled()) {
    statusEl.textContent = "";
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  const { data, error } = await sb.from("promo_settings").select("is_active").eq("id", 1).maybeSingle();
  const active = !error && data ? !!data.is_active : false;
  btn.textContent = active ? "⏸️ Desativar Modo Promo" : "⚡ Ativar Modo Promo";
  statusEl.textContent = active ? "Modo Promo está ATIVO no site agora." : "Modo Promo está desativado no site.";
}

document.getElementById("promo-quick-toggle").addEventListener("click", async () => {
  if (!supabaseEnabled()) return;
  const btn = document.getElementById("promo-quick-toggle");
  btn.disabled = true;
  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");

    const { data, error: fetchError } = await sb.from("promo_settings").select("is_active").eq("id", 1).maybeSingle();
    if (fetchError) throw fetchError;
    const nextActive = !(data && data.is_active);

    const { error } = await sb.from("promo_settings")
      .update({ is_active: nextActive, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw error;

    document.getElementById("promo-active").checked = nextActive;
    showToast(nextActive ? "Modo Promo ativado!" : "Modo Promo desativado.");
    if (typeof syncPromoState === "function") syncPromoState();
  } catch (err) {
    console.error("Ativar Modo Promo:", err);
    showToast(err.message || "Erro ao ativar o Modo Promo.");
  } finally {
    await refreshPromoQuickStatus();
  }
});

document.getElementById("promo-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const submitBtn = document.getElementById("promo-form-submit");
  const unavailable = document.getElementById("promo-form-unavailable");

  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";
  unavailable.hidden = true;

  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) {
      throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");
    }

    const { error: updateError } = await sb.from("promo_settings").update({
      is_active: document.getElementById("promo-active").checked,
      discount_percent: Number(document.getElementById("promo-discount").value) || 0,
      start_date: fromDatetimeLocalValue(document.getElementById("promo-start").value),
      end_date: fromDatetimeLocalValue(document.getElementById("promo-end").value),
      updated_at: new Date().toISOString()
    }).eq("id", 1);
    if (updateError) { updateError.step = "insert"; throw updateError; }

    showToast("Campanha salva com sucesso");
    if (typeof syncPromoState === "function") syncPromoState();
    refreshPromoQuickStatus();
  } catch (err) {
    console.error("Campanha de desconto:", err);
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(err, { table: "promo_settings", step: "Passo 9" });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar Configurações";
  }
});

/* Lista "Modo Promo por peça" — toggle individual, salva na hora. */
async function renderPromoProductsList() {
  const list = document.getElementById("admin-promo-products");
  const empty = document.getElementById("admin-promo-products-empty");
  if (!supabaseEnabled()) {
    list.innerHTML = "";
    empty.hidden = true;
    return;
  }
  const { data, error } = await sb.from("products").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("Listar peças (promo):", error);
    list.innerHTML = "";
    empty.hidden = true;
    return;
  }
  const products = data.map(rowToProduct);
  empty.hidden = products.length !== 0;
  list.innerHTML = products.map(p => `
    <div class="admin-promo-item" data-product-id="${p.id}">
      <img class="admin-promo-photo" src="${p.image || ""}" alt="${p.name}" onerror="this.style.visibility='hidden'">
      <div class="admin-promo-body">
        <span class="admin-promo-name">${p.name}</span>
        <span class="admin-promo-meta">${labelCategory(p.category)} · ${money(p.price)}</span>
      </div>
      <label class="admin-promo-switch-field">
        <span>Modo Promo</span>
        <input type="checkbox" class="promo-switch admin-promo-item-toggle" data-product-id="${p.id}" ${p.isPromo ? "checked" : ""}>
      </label>
    </div>
  `).join("");
}

document.getElementById("admin-promo-products").addEventListener("change", async e => {
  const toggle = e.target.closest(".admin-promo-item-toggle");
  if (!toggle) return;
  const id = toggle.dataset.productId;
  toggle.disabled = true;

  const { error } = await sb.from("products").update({ is_promo: toggle.checked }).eq("id", id);
  if (error) {
    console.error("Atualizar Modo Promo:", error);
    showToast("Erro ao atualizar Modo Promo");
    toggle.checked = !toggle.checked;
  } else {
    showToast(toggle.checked ? "Peça marcada para a promoção" : "Peça removida da promoção");
    if (typeof syncCatalog === "function") syncCatalog();
  }
  toggle.disabled = false;
});

/* =====================================================
   DISPARAR AVISO DE MODO PROMO — usa o template "promo" (aba "Textos
   do Modal") pra avisar todo mundo inscrito. E-mail sai automático
   via Resend, um a um. WhatsApp não tem envio em massa automático sem
   a API paga: aqui é um clique por contato (abre o wa.me já pronto).
===================================================== */
function promoWhatsappContacts() {
  const map = new Map();
  adminOrders.forEach(o => {
    const phone = (o.customer.telefone || "").replace(/\D/g, "");
    if (o.marketingOptIn && phone) map.set(phone, o.customer.nome || "Cliente");
  });
  return [...map.entries()].map(([telefone, nome]) => ({ telefone, nome }));
}

function renderPromoDispatchWhatsappList() {
  const list = document.getElementById("promo-dispatch-whatsapp-list");
  const empty = document.getElementById("promo-dispatch-whatsapp-empty");
  const contacts = promoWhatsappContacts();
  empty.hidden = contacts.length !== 0;
  list.innerHTML = contacts.map(c => `
    <div class="promo-whatsapp-contact" data-phone="${c.telefone}">
      <div>
        <span class="promo-whatsapp-contact-name">${c.nome}</span>
        <span class="promo-whatsapp-contact-phone">${c.telefone}</span>
      </div>
      <button type="button" class="pill pill-sm promo-whatsapp-send-btn" data-phone="${c.telefone}" data-nome="${c.nome.replace(/"/g, "&quot;")}">Enviar</button>
    </div>
  `).join("");
}

function openPromoDispatchModal() {
  document.getElementById("promo-dispatch-unavailable").hidden = true;
  const count = subscribedEmails().length;
  document.getElementById("promo-dispatch-email-count").textContent =
    count === 0 ? "Nenhum inscrito com e-mail." : `${count} inscrito${count === 1 ? "" : "s"} vão receber o e-mail.`;
  const emailBtn = document.getElementById("promo-dispatch-email-btn");
  emailBtn.disabled = false;
  emailBtn.textContent = "Enviar e-mails agora";
  renderPromoDispatchWhatsappList();
  document.getElementById("promo-dispatch-overlay").classList.add("open");
}
function closePromoDispatchModal() {
  document.getElementById("promo-dispatch-overlay").classList.remove("open");
}
document.getElementById("promo-dispatch-open").addEventListener("click", openPromoDispatchModal);
document.getElementById("promo-dispatch-close").addEventListener("click", closePromoDispatchModal);
document.getElementById("promo-dispatch-overlay").addEventListener("click", e => {
  if (e.target.id === "promo-dispatch-overlay") closePromoDispatchModal();
});

document.getElementById("promo-dispatch-email-btn").addEventListener("click", async () => {
  const btn = document.getElementById("promo-dispatch-email-btn");
  const unavailable = document.getElementById("promo-dispatch-unavailable");
  unavailable.hidden = true;
  const emails = subscribedEmails();
  if (emails.length === 0) {
    unavailable.hidden = false;
    unavailable.textContent = "Nenhum cliente inscrito para receber o aviso ainda.";
    return;
  }

  const tpl = getMessageTemplate("promo");
  btn.disabled = true;
  let sent = 0;
  for (const to of emails) {
    btn.textContent = `Enviando ${sent + 1}/${emails.length}...`;
    const order = adminOrders.find(o => o.customer.email === to) || { customer: { nome: "" }, id: "" };
    const subject = fillTemplate(tpl.subject, order);
    const body = fillTemplate(tpl.body, order);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, html: buildEmailHtml(subject, body, tpl.imageUrl) })
      });
      if (res.ok) sent += 1;
    } catch (err) {
      console.error("Envio de aviso de promo para", to, err);
    }
  }
  showToast(`Aviso de promo enviado para ${sent} de ${emails.length} inscrito${emails.length === 1 ? "" : "s"}.`);
  btn.disabled = false;
  btn.textContent = "Enviar e-mails agora";
});

document.getElementById("promo-dispatch-whatsapp-list").addEventListener("click", e => {
  const sendBtn = e.target.closest(".promo-whatsapp-send-btn");
  if (!sendBtn) return;
  const tpl = getMessageTemplate("promo");
  const order = { customer: { nome: sendBtn.dataset.nome, telefone: sendBtn.dataset.phone }, id: "" };
  window.open(`https://wa.me/${sendBtn.dataset.phone}?text=${encodeURIComponent(fillTemplate(tpl.whatsapp, order))}`, "_blank");
  sendBtn.closest(".promo-whatsapp-contact").classList.add("sent");
  sendBtn.textContent = "Enviado";
});

/* =====================================================
   DESCONTO NO CARRINHO + FRETE GRÁTIS (aba "Promoção e Desconto")
   Duas telas, uma tabela só (public.cart_discounts, linha única id=1).
===================================================== */
async function setupCartDiscountForm() {
  const unavailable = document.getElementById("cart-discount-form-unavailable");
  const discountSubmit = document.getElementById("cart-discount-form-submit");
  const shippingSubmit = document.getElementById("free-shipping-form-submit");

  if (!supabaseEnabled()) {
    unavailable.hidden = false;
    unavailable.textContent = "Edição indisponível: configure o Supabase (veja SUPABASE.md).";
    discountSubmit.disabled = true;
    shippingSubmit.disabled = true;
    return;
  }
  unavailable.hidden = true;
  discountSubmit.disabled = false;
  shippingSubmit.disabled = false;

  const { data, error } = await sb.from("cart_discounts").select("*").eq("id", 1).maybeSingle();
  if (error) {
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(error, { table: "cart_discounts", step: "Passo 12" });
    discountSubmit.disabled = true;
    shippingSubmit.disabled = true;
    return;
  }
  if (!data) return;

  const settings = rowToCartDiscount(data);
  document.getElementById("cd-active").checked = settings.active;
  document.getElementById("cd-type").value = settings.type;
  document.getElementById("cd-value").value = settings.value;
  document.getElementById("cd-min-cart").value = settings.minCart;
  document.getElementById("cd-requires-coupon").checked = settings.requiresCoupon;
  document.getElementById("cd-coupon-code").value = settings.couponCode;
  document.getElementById("fs-active").checked = settings.freeShippingActive;
  document.getElementById("fs-min-cart").value = settings.freeShippingMinCart;
}

document.getElementById("cart-discount-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const submitBtn = document.getElementById("cart-discount-form-submit");
  const unavailable = document.getElementById("cart-discount-form-unavailable");
  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";
  unavailable.hidden = true;

  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");

    const { error } = await sb.from("cart_discounts").update({
      discount_enabled: document.getElementById("cd-active").checked,
      discount_type: document.getElementById("cd-type").value,
      discount_value: Number(document.getElementById("cd-value").value) || 0,
      discount_min_cart: Number(document.getElementById("cd-min-cart").value) || 0,
      discount_requires_coupon: document.getElementById("cd-requires-coupon").checked,
      discount_coupon_code: document.getElementById("cd-coupon-code").value.trim(),
      updated_at: new Date().toISOString()
    }).eq("id", 1);
    if (error) throw error;

    showToast("Desconto salvo com sucesso");
    if (typeof syncCartDiscountSettings === "function") syncCartDiscountSettings();
  } catch (err) {
    console.error("Desconto no carrinho:", err);
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(err, { table: "cart_discounts", step: "Passo 12" });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar Desconto";
  }
});

document.getElementById("free-shipping-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const submitBtn = document.getElementById("free-shipping-form-submit");
  const unavailable = document.getElementById("cart-discount-form-unavailable");
  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";

  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");

    const { error } = await sb.from("cart_discounts").update({
      free_shipping_enabled: document.getElementById("fs-active").checked,
      free_shipping_min_cart: Number(document.getElementById("fs-min-cart").value) || 0,
      updated_at: new Date().toISOString()
    }).eq("id", 1);
    if (error) throw error;

    showToast("Frete grátis salvo com sucesso");
    if (typeof syncCartDiscountSettings === "function") syncCartDiscountSettings();
  } catch (err) {
    console.error("Frete grátis:", err);
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(err, { table: "cart_discounts", step: "Passo 12" });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar Frete Grátis";
  }
});

/* =====================================================
   CONFIGURAÇÕES DE ENVIO (aba "Promoção e Desconto") — medidas e
   peso padrão de UMA peça, salvos em public.shipping_settings (linha
   única, id=1). NÃO afeta o frete cobrado do cliente (isso continua
   fixo, R$18/R$10, calculado em js/checkout.js) — é só o dado usado
   depois pra gerar etiqueta de envio (Melhor Envio, etapa futura).
===================================================== */
async function setupShippingSettingsForm() {
  const unavailable = document.getElementById("shipping-settings-form-unavailable");
  const submitBtn = document.getElementById("shipping-settings-form-submit");
  if (!supabaseEnabled()) {
    unavailable.hidden = false;
    unavailable.textContent = "Edição indisponível: configure o Supabase (veja SUPABASE.md).";
    submitBtn.disabled = true;
    return;
  }
  unavailable.hidden = true;
  submitBtn.disabled = false;

  const { data, error } = await sb.from("shipping_settings").select("*").eq("id", 1).maybeSingle();
  if (error) {
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(error, { table: "shipping_settings", step: "Passo 20" });
    submitBtn.disabled = true;
    return;
  }
  if (!data) return;

  document.getElementById("ss-altura").value = data.height_cm;
  document.getElementById("ss-largura").value = data.width_cm;
  document.getElementById("ss-comprimento").value = data.length_cm;
  document.getElementById("ss-peso").value = data.weight_kg;

  refreshMelhorEnvioStatus();
}

/* Só mostra conectado/não conectado + validade — o token em si nunca
   sai do Worker (fica em public.melhorenvio_tokens, só a service_role
   key toca essa tabela). */
async function refreshMelhorEnvioStatus() {
  const statusEl = document.getElementById("melhorenvio-status");
  const connectBtn = document.getElementById("melhorenvio-connect");
  try {
    const res = await fetch("/api/melhorenvio/status");
    const data = await res.json();
    if (data.connected) {
      const expires = data.expiresAt ? new Date(data.expiresAt).toLocaleDateString("pt-BR") : "";
      statusEl.textContent = `✅ Conectado${expires ? ` — token válido até ${expires}` : ""}`;
      connectBtn.textContent = "🔄 Reconectar Melhor Envio";
    } else {
      statusEl.textContent = "⚠️ Ainda não conectado.";
      connectBtn.textContent = "🔗 Conectar Melhor Envio";
    }
  } catch (err) {
    console.warn("Status Melhor Envio:", err);
    statusEl.textContent = "Não foi possível verificar a conexão agora.";
  }
}

document.getElementById("shipping-settings-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const submitBtn = document.getElementById("shipping-settings-form-submit");
  const unavailable = document.getElementById("shipping-settings-form-unavailable");
  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";
  unavailable.hidden = true;

  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");

    const { error } = await sb.from("shipping_settings").update({
      height_cm: Number(document.getElementById("ss-altura").value) || 0,
      width_cm: Number(document.getElementById("ss-largura").value) || 0,
      length_cm: Number(document.getElementById("ss-comprimento").value) || 0,
      weight_kg: Number(document.getElementById("ss-peso").value) || 0,
      updated_at: new Date().toISOString()
    }).eq("id", 1);
    if (error) throw error;

    showToast("Configurações de envio salvas com sucesso");
  } catch (err) {
    console.error("Configurações de envio:", err);
    unavailable.hidden = false;
    unavailable.textContent = describeSupabaseFormError(err, { table: "shipping_settings", step: "Passo 20" });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar Configurações de Envio";
  }
});

/* =====================================================
   ADMINISTRAR ATUALIZAÇÕES — aviso em massa (e-mail) para clientes
   que aceitaram receber novidades no checkout (marketing_opt_in).
   Dispara de verdade, um a um, via /api/send-email (Resend) — sem
   abrir nenhum app de e-mail nem exigir confirmação manual. O
   WhatsApp em massa NÃO dá pra automatizar: os links wa.me exigem um
   clique de "enviar" por contato (não existe API gratuita pra isso —
   só a API paga do WhatsApp Business), então esse botão cobre só
   e-mail mesmo.
===================================================== */
let selectedUpdatePhoto = null;

function subscribedEmails() {
  const emails = new Set();
  adminOrders.forEach(o => {
    if (o.marketingOptIn && o.customer.email) emails.add(o.customer.email.trim());
  });
  return [...emails];
}

function renderUpdatePhotoPreview() {
  const wrap = document.getElementById("upd-foto-preview");
  wrap.innerHTML = !selectedUpdatePhoto ? "" : `
    <div class="pf-image-thumb">
      <img src="${URL.createObjectURL(selectedUpdatePhoto)}" alt="${selectedUpdatePhoto.name}">
      <button type="button" class="pf-image-remove" id="upd-foto-remove" aria-label="Remover foto">&times;</button>
    </div>
  `;
}

function openUpdatesModal() {
  document.getElementById("admin-updates-form").reset();
  selectedUpdatePhoto = null;
  renderUpdatePhotoPreview();
  const count = subscribedEmails().length;
  document.getElementById("admin-updates-count").textContent =
    count === 0 ? "Nenhum inscrito para receber avisos ainda." : `${count} inscrito${count === 1 ? "" : "s"} ${count === 1 ? "vai" : "vão"} receber esse aviso.`;
  document.getElementById("admin-updates-unavailable").hidden = true;
  document.getElementById("admin-updates-overlay").classList.add("open");
}
function closeUpdatesModal() {
  document.getElementById("admin-updates-overlay").classList.remove("open");
}
document.getElementById("admin-updates-open").addEventListener("click", openUpdatesModal);
document.getElementById("admin-updates-close").addEventListener("click", closeUpdatesModal);
document.getElementById("admin-updates-overlay").addEventListener("click", e => {
  if (e.target.id === "admin-updates-overlay") closeUpdatesModal();
});

document.getElementById("upd-foto").addEventListener("change", e => {
  selectedUpdatePhoto = e.target.files[0] || null;
  e.target.value = "";
  renderUpdatePhotoPreview();
});
document.getElementById("upd-foto-preview").addEventListener("click", e => {
  if (!e.target.closest("#upd-foto-remove")) return;
  selectedUpdatePhoto = null;
  renderUpdatePhotoPreview();
});

document.getElementById("admin-updates-form").addEventListener("submit", async e => {
  e.preventDefault();
  const unavailable = document.getElementById("admin-updates-unavailable");
  const submitBtn = document.getElementById("admin-updates-submit");
  unavailable.hidden = true;

  const emails = subscribedEmails();
  if (emails.length === 0) {
    unavailable.hidden = false;
    unavailable.textContent = "Nenhum cliente inscrito para receber avisos ainda.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Preparando...";
  try {
    let photoUrl = "";
    if (selectedUpdatePhoto) {
      if (!supabaseEnabled()) throw new Error("Configure o Supabase para subir a foto spoiler (veja SUPABASE.md).");
      const { data: sessionData } = await sb.auth.getSession();
      if (!sessionData.session) throw new Error("Sua sessão expirou. Clique em \"Sair\" e faça login de novo.");

      const path = `spoiler-${Date.now()}-${selectedUpdatePhoto.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error: uploadError } = await sb.storage.from("spoilers").upload(path, selectedUpdatePhoto);
      if (uploadError) throw uploadError;
      photoUrl = sb.storage.from("spoilers").getPublicUrl(path).data.publicUrl;
    }

    const dia = document.getElementById("upd-dia").value.trim();
    const horario = document.getElementById("upd-horario").value.trim();
    const link = document.getElementById("upd-link").value.trim();

    const subject = "Re.cyber — Nova atualização chegando! ⚡";
    let body = `Fique de olho para não perder os melhores garimpos sustentáveis que acabaram de cair no nosso catálogo.\n\n📅 Dia: ${dia}\n⏰ Horário: ${horario}\n\n🔗 Acesse e garimpe antes de todo mundo: ${link}`;
    if (photoUrl) body += `\n\n📸 Prévia da atualização em anexo.`;
    const html = buildEmailHtml(subject, body, photoUrl);

    let sent = 0;
    for (const to of emails) {
      submitBtn.textContent = `Enviando ${sent + 1}/${emails.length}...`;
      try {
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, subject, html })
        });
        if (res.ok) sent += 1;
      } catch (err) {
        console.error("Envio de atualização para", to, err);
      }
    }

    showToast(`Aviso enviado para ${sent} de ${emails.length} inscrito${emails.length === 1 ? "" : "s"}.`);
    closeUpdatesModal();
  } catch (err) {
    console.error("Administrar atualizações:", err);
    unavailable.hidden = false;
    unavailable.textContent = err.message || "Erro ao disparar o aviso.";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Disparar Alerta";
  }
});

/* "Porta secreta": 3 cliques seguidos em "SINCE 2021" abrem #admin-login. */
(function setupSecretAdminTrigger() {
  const trigger = document.getElementById("secret-admin-trigger");
  if (!trigger) return;
  let clicks = 0;
  let resetTimer;
  trigger.addEventListener("click", () => {
    clicks += 1;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { clicks = 0; }, 800);
    if (clicks >= 3) {
      clicks = 0;
      window.location.hash = "#admin-login";
    }
  });
})();
