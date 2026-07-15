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

function cancellationMessage(order) {
  return `Olá ${order.customer.nome}! Seu pedido ${order.id} no ${CONFIG.storeName} foi cancelado. Se já tiver feito o pagamento ou tiver alguma dúvida, é só responder por aqui que a gente resolve. 🙏`;
}

/* WhatsApp (wa.me) e e-mail (mailto) abrem com o texto já pronto — o
   administrador confirma o envio em cada app; este site não tem um
   serviço de e-mail transacional configurado para envio 100% automático. */
function notifyCustomerBothChannels(order, subject, text) {
  const phone = order.customer.telefone.replace(/\D/g, "");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  window.open(`mailto:${order.customer.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, "_blank");
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
  const text = statusMessage(order, status);
  const subject = `${CONFIG.storeName} — Atualização do pedido ${order.id}`;
  notifyCustomerBothChannels(order, subject, text);
  updateOrder(orderId, { status });
}

/* =====================================================
   ABA: PEDIDOS / PAGAMENTOS
===================================================== */
/* Miniatura da peça — busca a foto no catálogo público (PRODUCTS,
   compartilhado via js/catalog-sync.js) pelo id salvo no pedido. */
function productThumbHtml(itemId, itemName) {
  const p = typeof PRODUCTS !== "undefined" ? PRODUCTS.find(pr => pr.id === itemId) : null;
  const img = p && p.image;
  if (!img) return `<span class="order-item-thumb order-item-thumb--empty" aria-hidden="true"></span>`;
  return `<img class="order-item-thumb" src="${img}" alt="${itemName}" loading="lazy">`;
}

function orderCardHtml(order) {
  const date = new Date(order.createdAt).toLocaleString("pt-BR");
  const thumbsHtml = order.items.map(i => productThumbHtml(i.id, i.name)).join("");
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

      <div class="order-card-grid">
        <div class="order-block order-block--panel">
          <h4>Cliente</h4>
          <p>${order.customer.nome}</p>
          <p>${order.customer.email} · ${order.customer.telefone}</p>
          <p>CPF: ${order.customer.cpf}</p>
          <div class="order-block-divider"></div>
          <h4>Endereço</h4>
          <p>${order.customer.logradouro}, ${order.customer.numero}${order.customer.complemento ? ` — ${order.customer.complemento}` : ""}</p>
          <p>${order.customer.bairro} · CEP ${order.customer.cep}</p>
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
   RENDER GERAL + ABAS
===================================================== */
async function renderAdmin() {
  const orders = await loadOrders();
  adminOrders = orders;
  document.getElementById("admin-count").textContent = `${orders.length} pedido${orders.length === 1 ? "" : "s"}`;
  document.getElementById("admin-orders").innerHTML = orders.map(orderCardHtml).join("");
  document.getElementById("admin-empty").hidden = orders.length !== 0;
  renderLeads(orders);
}

document.getElementById("admin-tabs").addEventListener("click", e => {
  const pill = e.target.closest("[data-tab]");
  if (!pill) return;
  document.querySelectorAll("#admin-tabs .pill").forEach(p => p.classList.toggle("active", p === pill));
  ["leads", "pedidos", "cadastro", "feedbacks", "textos", "promo"].forEach(tab => {
    document.getElementById(`admin-tab-${tab}`).hidden = tab !== pill.dataset.tab;
  });
});

document.getElementById("admin-orders").addEventListener("click", e => {
  const btn = e.target.closest("button[data-order]");
  if (!btn) return;
  triggerStatusNotification(btn.dataset.order, btn.dataset.status);
});
document.getElementById("admin-orders").addEventListener("change", e => {
  const sel = e.target.closest(".pay-status-select");
  if (!sel) return;
  const newStatus = sel.value;

  /* Esconde/mostra os botões de logística na hora, sem esperar o
     update assíncrono terminar (evita notificar por engano um pedido
     que acabou de ser cancelado, e reaparece se o status voltar). */
  const actions = sel.closest(".order-card")?.querySelector(".order-actions");
  if (actions) actions.hidden = newStatus === "cancelado";

  /* Abre as notificações ANTES do update assíncrono — se esperarmos a
     resposta do Supabase primeiro, alguns navegadores tratam o
     window.open() como fora do gesto do usuário e bloqueiam o popup. */
  if (newStatus === "cancelado") {
    const order = adminOrders.find(o => o.id === sel.dataset.order);
    if (order) {
      const text = cancellationMessage(order);
      const subject = `${CONFIG.storeName} — Pedido ${order.id} cancelado`;
      notifyCustomerBothChannels(order, subject, text);
    }
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
  setupPromoForm();
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
}

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
   TEMA CLARO/ESCURO DO PAINEL
===================================================== */
const ADMIN_THEME_KEY = "recyber_admin_theme";

function applyAdminTheme(theme) {
  document.getElementById("admin-panel").dataset.theme = theme;
  document.getElementById("admin-theme-toggle").innerHTML = theme === "dark" ? "&#9789;" : "&#9788;";
}

(function setupAdminThemeToggle() {
  const saved = localStorage.getItem(ADMIN_THEME_KEY) || "light";
  applyAdminTheme(saved);
  document.getElementById("admin-theme-toggle").addEventListener("click", () => {
    const next = document.getElementById("admin-panel").dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(ADMIN_THEME_KEY, next);
    applyAdminTheme(next);
  });
})();

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
