/* =====================================================
   PAINEL DE CONTROLE (ADMIN) — rota oculta #painel-admin
   Depende de: CONFIG, money() (js/app.js) e getOrders()/saveOrders()
   (js/checkout.js). Lê pedidos do localStorage deste navegador —
   não existe backend, então pedidos feitos em outro dispositivo não
   aparecem aqui.
===================================================== */
const STATUS_LABELS = {
  recebido: "Recebido",
  "em-preparacao": "Em preparação",
  enviado: "Enviado"
};

function statusMessage(order, status) {
  if (status === "em-preparacao") {
    return `Olá ${order.customer.nome}! Seu pedido ${order.id} no ${CONFIG.storeName} está em preparação. Assim que for enviado, você recebe o código de rastreio por aqui. 💚`;
  }
  return `Olá ${order.customer.nome}! Seu pedido ${order.id} no ${CONFIG.storeName} foi enviado! Em breve você recebe o código de rastreio para acompanhar a entrega. 📦`;
}

function updateOrderStatus(orderId, status) {
  const orders = getOrders();
  const order = orders.find(o => o.id === orderId);
  if (order) order.status = status;
  saveOrders(orders);
  renderAdmin();
}

function triggerNotification(orderId, status, channel) {
  const order = getOrders().find(o => o.id === orderId);
  if (!order) return;
  const text = statusMessage(order, status);

  if (channel === "whatsapp") {
    const phone = order.customer.telefone.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  } else {
    const subject = encodeURIComponent(`${CONFIG.storeName} — Atualização do pedido ${order.id}`);
    window.open(`mailto:${order.customer.email}?subject=${subject}&body=${encodeURIComponent(text)}`, "_blank");
  }
  updateOrderStatus(orderId, status);
}

function orderCardHtml(order) {
  const date = new Date(order.createdAt).toLocaleString("pt-BR");
  const itemsHtml = order.items.map(i => `<li>${i.qty}x ${i.name} (Tam. ${i.size}) — ${money(i.price * i.qty)}</li>`).join("");
  const paymentLabel = order.payment === "pix" ? "Pix" : "Cartão de Crédito";

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

function renderAdmin() {
  const orders = getOrders().slice().reverse();
  document.getElementById("admin-count").textContent = `${orders.length} pedido${orders.length === 1 ? "" : "s"}`;
  document.getElementById("admin-orders").innerHTML = orders.map(orderCardHtml).join("");
  document.getElementById("admin-empty").hidden = orders.length !== 0;
}

document.getElementById("admin-orders").addEventListener("click", e => {
  const btn = e.target.closest("[data-order]");
  if (!btn) return;
  triggerNotification(btn.dataset.order, btn.dataset.status, btn.dataset.channel);
});

function isAdminHash() {
  return window.location.hash.startsWith("#painel-admin");
}

function showAdminPanel() {
  renderAdmin();
  document.getElementById("admin-panel").hidden = false;
  document.body.classList.add("admin-open");
}
function hideAdminPanel() {
  document.getElementById("admin-panel").hidden = true;
  document.body.classList.remove("admin-open");
}

function syncAdminRoute() {
  if (isAdminHash()) showAdminPanel();
  else hideAdminPanel();
}

document.getElementById("admin-close").addEventListener("click", () => {
  window.location.hash = "#catalogo";
});

window.addEventListener("hashchange", syncAdminRoute);
syncAdminRoute();
