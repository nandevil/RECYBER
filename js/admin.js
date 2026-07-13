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
    const { data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("Supabase select:", error);
      showToast("Erro ao carregar os pedidos");
      return [];
    }
    return data.map(rowToOrder);
  }
  return getOrders().slice().reverse();
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

function statusMessage(order, status) {
  if (status === "em-preparacao") {
    return `Olá ${order.customer.nome}! Seu pedido ${order.id} no ${CONFIG.storeName} está em preparação. Assim que for enviado, você recebe o código de rastreio por aqui. 💚`;
  }
  return `Olá ${order.customer.nome}! Seu pedido ${order.id} no ${CONFIG.storeName} foi enviado! Em breve você recebe o código de rastreio para acompanhar a entrega. 📦`;
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

function triggerNotification(orderId, status, channel) {
  const order = adminOrders.find(o => o.id === orderId);
  if (!order) return;
  const text = statusMessage(order, status);

  if (channel === "whatsapp") {
    const phone = order.customer.telefone.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  } else {
    const subject = encodeURIComponent(`${CONFIG.storeName} — Atualização do pedido ${order.id}`);
    window.open(`mailto:${order.customer.email}?subject=${subject}&body=${encodeURIComponent(text)}`, "_blank");
  }
  updateOrder(orderId, { status });
}

/* =====================================================
   ABA: PEDIDOS / PAGAMENTOS
===================================================== */
function orderCardHtml(order) {
  const date = new Date(order.createdAt).toLocaleString("pt-BR");
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
        <span class="order-status order-status--${order.status}">${STATUS_LABELS[order.status] || order.status}</span>
      </div>
      <span class="order-date">${date}</span>

      <div class="order-block">
        <h4>Cliente</h4>
        <p>${order.customer.nome}</p>
        <p>${order.customer.email} · ${order.customer.telefone}</p>
        <p>CPF: ${order.customer.cpf}</p>
      </div>

      <div class="order-block">
        <h4>Endereço</h4>
        <p>${order.customer.logradouro}, ${order.customer.numero}${order.customer.complemento ? ` — ${order.customer.complemento}` : ""}</p>
        <p>${order.customer.bairro} · CEP ${order.customer.cep}</p>
      </div>

      <div class="order-block">
        <h4>Peças (${order.items.reduce((n, i) => n + i.qty, 0)})</h4>
        <ul class="order-items">${itemsHtml}</ul>
      </div>

      <div class="order-block order-totals">
        <p>Subtotal: ${money(order.subtotal)}</p>
        <p>Frete: ${money(order.shipping)}</p>
        <p class="order-total-final">Total: ${money(order.total)}</p>
        <p>Pagamento: ${paymentLabel}</p>
      </div>

      <div class="order-block order-payment-status">
        <h4>Status do pagamento</h4>
        <select class="sort-select pay-status-select pay-status--${payStatus}" data-order="${order.id}">${payOptions}</select>
      </div>

      <div class="order-actions">
        <div class="order-action-group">
          <span>Em preparação</span>
          <button type="button" class="pill pill-sm" data-order="${order.id}" data-status="em-preparacao" data-channel="whatsapp">WhatsApp</button>
          <button type="button" class="pill pill-sm" data-order="${order.id}" data-status="em-preparacao" data-channel="email">E-mail</button>
        </div>
        <div class="order-action-group">
          <span>Enviado</span>
          <button type="button" class="pill pill-sm" data-order="${order.id}" data-status="enviado" data-channel="whatsapp">WhatsApp</button>
          <button type="button" class="pill pill-sm" data-order="${order.id}" data-status="enviado" data-channel="email">E-mail</button>
        </div>
      </div>
    </div>
  `;
}

/* =====================================================
   ABA: LEADS + EXPORTAÇÃO CSV
===================================================== */
function renderLeads(orders) {
  const rows = orders.map(o => `
    <tr>
      <td data-label="E-mail">${o.customer.email}</td>
      <td data-label="WhatsApp">${o.customer.telefone}</td>
      <td data-label="Origem">Checkout — Finalizado</td>
      <td data-label="Status de Marketing"><span class="lead-status lead-status--${o.marketingOptIn ? "inscrito" : "nao"}">${o.marketingOptIn ? "Inscrito" : "Não inscrito"}</span></td>
    </tr>
  `).join("");
  document.getElementById("admin-leads-body").innerHTML = rows;
  document.getElementById("admin-leads-empty").hidden = orders.length !== 0;
  document.querySelector(".admin-leads-table-wrap").hidden = orders.length === 0;
}

function exportLeadsCsv() {
  const orders = adminOrders;
  if (orders.length === 0) {
    showToast("Nenhum lead para exportar");
    return;
  }
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ["Nome", "E-mail", "WhatsApp", "Origem", "Status de Marketing"].join(","),
    ...orders.map(o => [
      esc(o.customer.nome),
      esc(o.customer.email),
      esc(o.customer.telefone),
      esc("Checkout - Finalizado"),
      esc(o.marketingOptIn ? "Inscrito" : "Nao inscrito")
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
   ABA: CLIENTES (agregado por e-mail)
===================================================== */
function renderClients(orders) {
  const byEmail = new Map();
  orders.forEach(o => {
    const key = o.customer.email.toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, { nome: o.customer.nome, email: o.customer.email, telefone: o.customer.telefone, orders: [] });
    }
    byEmail.get(key).orders.push(o);
  });

  const html = [...byEmail.values()].map(c => {
    const total = c.orders.reduce((s, o) => s + o.total, 0);
    const history = c.orders.map(o => {
      const date = new Date(o.createdAt).toLocaleDateString("pt-BR");
      const items = o.items.map(i => `${i.qty}x ${i.name}`).join(", ");
      return `<li>${date} · ${o.id} · ${items} — ${money(o.total)}</li>`;
    }).join("");
    return `
      <div class="order-card">
        <div class="order-card-head">
          <span class="order-id">${c.nome}</span>
          <span class="order-status">${c.orders.length} compra${c.orders.length === 1 ? "" : "s"}</span>
        </div>
        <div class="order-block">
          <p>${c.email} · ${c.telefone}</p>
          <p class="order-total-final">Total gasto: ${money(total)}</p>
        </div>
        <div class="order-block">
          <h4>Histórico de compras</h4>
          <ul class="order-items">${history}</ul>
        </div>
      </div>
    `;
  }).join("");

  document.getElementById("admin-clients").innerHTML = html;
  document.getElementById("admin-clients-empty").hidden = orders.length !== 0;
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
  renderLeads(orders);
  renderClients(orders);
}

document.getElementById("admin-tabs").addEventListener("click", e => {
  const pill = e.target.closest("[data-tab]");
  if (!pill) return;
  document.querySelectorAll("#admin-tabs .pill").forEach(p => p.classList.toggle("active", p === pill));
  ["leads", "pedidos", "clientes"].forEach(tab => {
    document.getElementById(`admin-tab-${tab}`).hidden = tab !== pill.dataset.tab;
  });
});

document.getElementById("admin-orders").addEventListener("click", e => {
  const btn = e.target.closest("button[data-order]");
  if (!btn) return;
  triggerNotification(btn.dataset.order, btn.dataset.status, btn.dataset.channel);
});
document.getElementById("admin-orders").addEventListener("change", e => {
  const sel = e.target.closest(".pay-status-select");
  if (!sel) return;
  updateOrder(sel.dataset.order, { paymentStatus: sel.value });
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
