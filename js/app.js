/* =====================================================
   CONFIGURAÇÃO DA LOJA — edite aqui
===================================================== */
const CONFIG = {
  whatsappNumber: "5521999999999", // troque pelo número real (DDI+DDD+numero, só dígitos)
  instagram: "https://instagram.com/re.cyber",
  storeName: "Re.cyber"
};

/* =====================================================
   PLACEHOLDER DE IMAGEM (SVG inline, sem dependência externa)
===================================================== */
const CATEGORY_ICON_PATHS = {
  roupas: "M8 4l4-2 4 2 3 3-3 2v11H5V9L2 7l3-3z",
  acessorios: "M12 3l3 3-3 3-3-3 3-3zM5 12a7 7 0 1014 0 7 7 0 00-14 0z",
  calcados: "M4 15c0-2 1-3 3-4l6-3 2 2 5 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-1z"
};
const CATEGORY_BG = {
  roupas: "#dcdcd8",
  acessorios: "#d3d9d2",
  calcados: "#dcd6d9"
};

function placeholderImage(category, seed) {
  const bg = CATEGORY_BG[category] || "#d9d9d6";
  const path = CATEGORY_ICON_PATHS[category] || CATEGORY_ICON_PATHS.roupas;
  const shift = (seed % 5) * 6;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="${bg}"/>
      <g opacity="0.15">
        ${Array.from({ length: 6 }).map((_, i) =>
          `<line x1="${-20 + i * 40 + shift}" y1="220" x2="${20 + i * 40 + shift}" y2="-20" stroke="#161616" stroke-width="6"/>`
        ).join("")}
      </g>
      <g transform="translate(58,58) scale(3.5)" fill="none" stroke="#161616" stroke-width="1">
        <path d="${path}" />
      </g>
      <text x="100" y="182" text-anchor="middle" font-family="monospace" font-size="10" fill="#161616" opacity="0.55">RE.CYBER</text>
    </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/* =====================================================
   GERAR ANEL DE CIRCUITO (hero) E BARCODE (sobre)
===================================================== */
function buildCircuitRing() {
  const g = document.getElementById("circuit-ring");
  if (!g) return;
  const cx = 300, cy = 300;
  const ticks = 36;
  let html = "";
  for (let i = 0; i < ticks; i++) {
    const angle = (360 / ticks) * i;
    const len = i % 4 === 0 ? 26 : i % 2 === 0 ? 16 : 8;
    const r1 = 228;
    const r2 = r1 + len;
    html += `<g transform="rotate(${angle} ${cx} ${cy})">
      <line x1="${cx}" y1="${cy - r1}" x2="${cx}" y2="${cy - r2}" stroke="#161616" stroke-width="2"/>
      ${i % 9 === 0 ? `<rect x="${cx - 7}" y="${cy - r2 - 13}" width="14" height="13" fill="#161616"/>` : ""}
      ${i % 4 === 0 && i % 9 !== 0 ? `<line x1="${cx - 5}" y1="${cy - r2 - 9}" x2="${cx + 5}" y2="${cy - r2 - 9}" stroke="#161616" stroke-width="2"/>` : ""}
    </g>`;
  }
  html += `<circle cx="${cx}" cy="${cy}" r="272" fill="none" stroke="#161616" stroke-width="1" stroke-dasharray="4 7" opacity="0.5"/>`;
  g.innerHTML = html;
}

function buildBarcode() {
  const g = document.getElementById("barcode-bars");
  if (!g) return;
  let x = 4, html = "";
  while (x < 216) {
    const w = [2, 3, 5][Math.floor(Math.random() * 3)];
    if (Math.random() > 0.35) {
      html += `<rect x="${x}" y="4" width="${w}" height="54" fill="#161616"/>`;
    }
    x += w + 2;
  }
  html += `<text x="110" y="70" text-anchor="middle" font-family="monospace" font-size="9" fill="#161616">RE-CYBER-2021</text>`;
  g.innerHTML = html;
}

/* =====================================================
   ESTADO
===================================================== */
let state = {
  filter: "todos",
  search: "",
  sort: "novidades",
  cart: JSON.parse(localStorage.getItem("recyber_cart") || "[]")
};

function saveCart() {
  localStorage.setItem("recyber_cart", JSON.stringify(state.cart));
  updateCartUI();
}

function money(v) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* =====================================================
   RENDER — GRID DE PRODUTOS
===================================================== */
function getFilteredProducts() {
  let list = PRODUCTS.filter(p => {
    const matchesFilter = state.filter === "todos" || p.category === state.filter;
    const q = state.search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.size.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  if (state.sort === "menor-preco") list = [...list].sort((a, b) => a.price - b.price);
  if (state.sort === "maior-preco") list = [...list].sort((a, b) => b.price - a.price);
  if (state.sort === "novidades") list = [...list].sort((a, b) => (b.tag === "novo") - (a.tag === "novo"));

  return list;
}

function renderGrid() {
  const grid = document.getElementById("product-grid");
  const emptyState = document.getElementById("empty-state");
  const list = getFilteredProducts();

  grid.innerHTML = "";
  emptyState.hidden = list.length !== 0;

  list.forEach((p, idx) => {
    const img = p.image || placeholderImage(p.category, idx);
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-thumb" data-id="${p.id}">
        ${p.tag ? `<span class="product-badge">${p.tag === "novo" ? "Novo" : "Promo"}</span>` : ""}
        <img src="${img}" alt="${p.name}" loading="lazy">
      </div>
      <div class="product-info">
        <span class="product-cat">${labelCategory(p.category)}</span>
        <p class="product-name" data-id="${p.id}">${p.name}</p>
        <span class="product-meta">Tam. ${p.size} · ${p.condition}</span>
        <div class="product-price-row">
          <span class="product-price">${money(p.price)}</span>
          <button class="add-btn" data-id="${p.id}" aria-label="Adicionar ao carrinho">+</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".product-thumb, .product-name").forEach(el => {
    el.addEventListener("click", () => openModal(el.dataset.id));
  });
  grid.querySelectorAll(".add-btn").forEach(el => {
    el.addEventListener("click", () => {
      addToCart(el.dataset.id, 1);
      showToast("Adicionado ao carrinho");
    });
  });
}

function labelCategory(cat) {
  return { roupas: "Roupas", acessorios: "Acessórios", calcados: "Calçados" }[cat] || cat;
}

/* =====================================================
   FILTROS / BUSCA / ORDENAÇÃO
===================================================== */
function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.filter === filter));
  renderGrid();
}

document.querySelectorAll("[data-filter]").forEach(el => {
  el.addEventListener("click", e => {
    const f = el.dataset.filter;
    if (f) setFilter(f);
  });
});

document.getElementById("sort-select").addEventListener("change", e => {
  state.sort = e.target.value;
  renderGrid();
});

const searchInput = document.getElementById("search-input");
searchInput.addEventListener("input", e => {
  state.search = e.target.value;
  renderGrid();
});

document.getElementById("search-toggle").addEventListener("click", () => {
  document.getElementById("search-bar").classList.add("open");
  searchInput.focus();
});
document.getElementById("search-close").addEventListener("click", () => {
  document.getElementById("search-bar").classList.remove("open");
});

/* menu mobile */
document.getElementById("menu-toggle").addEventListener("click", () => {
  document.getElementById("main-nav").classList.toggle("open");
});
document.querySelectorAll(".main-nav a").forEach(a => {
  a.addEventListener("click", () => document.getElementById("main-nav").classList.remove("open"));
});

/* =====================================================
   CARRINHO
===================================================== */
function addToCart(id, qty) {
  const existing = state.cart.find(i => i.id === id);
  if (existing) {
    existing.qty += qty;
  } else {
    state.cart.push({ id, qty });
  }
  saveCart();
}

function updateQty(id, delta) {
  const item = state.cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter(i => i.id !== id);
  }
  saveCart();
}

function removeFromCart(id) {
  state.cart = state.cart.filter(i => i.id !== id);
  saveCart();
}

function cartTotal() {
  return state.cart.reduce((sum, item) => {
    const p = PRODUCTS.find(pr => pr.id === item.id);
    return p ? sum + p.price * item.qty : sum;
  }, 0);
}

function cartCount() {
  return state.cart.reduce((sum, i) => sum + i.qty, 0);
}

function updateCartUI() {
  const n = cartCount();
  document.getElementById("cart-count").textContent = n;
  const mobBadge = document.getElementById("mob-cart-count");
  if (mobBadge) mobBadge.textContent = n;
  const itemsEl = document.getElementById("cart-items");
  const emptyEl = document.getElementById("cart-empty");
  itemsEl.innerHTML = "";

  if (state.cart.length === 0) {
    emptyEl.style.display = "block";
  } else {
    emptyEl.style.display = "none";
    state.cart.forEach((item, idx) => {
      const p = PRODUCTS.find(pr => pr.id === item.id);
      if (!p) return;
      const img = p.image || placeholderImage(p.category, idx);
      const row = document.createElement("div");
      row.className = "cart-item";
      row.innerHTML = `
        <div class="cart-item-thumb"><img src="${img}" alt="${p.name}"></div>
        <div class="cart-item-info">
          <span class="cart-item-name">${p.name}</span>
          <span class="cart-item-meta">Tam. ${p.size} · ${money(p.price)}</span>
          <div class="cart-item-row">
            <div class="qty-control">
              <button data-action="dec" data-id="${p.id}">-</button>
              <span>${item.qty}</span>
              <button data-action="inc" data-id="${p.id}">+</button>
            </div>
            <button class="remove-btn" data-action="remove" data-id="${p.id}">remover</button>
          </div>
        </div>
      `;
      itemsEl.appendChild(row);
    });
  }

  itemsEl.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const { action, id } = btn.dataset;
      if (action === "inc") updateQty(id, 1);
      if (action === "dec") updateQty(id, -1);
      if (action === "remove") removeFromCart(id);
    });
  });

  document.getElementById("cart-subtotal").textContent = money(cartTotal());
}

function openCart() {
  document.getElementById("cart-drawer").classList.add("open");
  document.getElementById("overlay").classList.add("open");
}
function closeCart() {
  document.getElementById("cart-drawer").classList.remove("open");
  document.getElementById("overlay").classList.remove("open");
}
document.getElementById("cart-toggle").addEventListener("click", openCart);
document.getElementById("cart-close").addEventListener("click", closeCart);
document.getElementById("overlay").addEventListener("click", () => {
  closeCart();
  closeModal();
});

/* =====================================================
   CHECKOUT VIA WHATSAPP
===================================================== */
function buildWhatsappMessage(items) {
  let msg = `Olá! Vim do site *${CONFIG.storeName}* e quero fazer um pedido:\n\n`;
  items.forEach(item => {
    const p = PRODUCTS.find(pr => pr.id === item.id);
    if (!p) return;
    msg += `• ${p.name} (Tam. ${p.size}) x${item.qty} — ${money(p.price * item.qty)}\n`;
  });
  msg += `\n*Total: ${money(cartTotal())}*\n\nPodemos combinar pagamento e entrega?`;
  return encodeURIComponent(msg);
}

function whatsappLink(message) {
  return `https://wa.me/${CONFIG.whatsappNumber}?text=${message}`;
}

document.getElementById("checkout-btn").addEventListener("click", () => {
  if (state.cart.length === 0) {
    showToast("Seu carrinho está vazio");
    return;
  }
  window.open(whatsappLink(buildWhatsappMessage(state.cart)), "_blank");
});

const stickyReceba = document.getElementById("sticky-receba");
if (stickyReceba) {
  stickyReceba.addEventListener("click", () => {
    const msg = encodeURIComponent(`Olá! Vim do site ${CONFIG.storeName} e quero saber mais sobre as peças disponíveis.`);
    window.open(`https://wa.me/${CONFIG.whatsappNumber}?text=${msg}`, "_blank");
  });
}
const mobCartBtn = document.getElementById("mob-cart-btn");
if (mobCartBtn) mobCartBtn.addEventListener("click", openCart);
const mobMenuBtn = document.getElementById("mob-menu-btn");
if (mobMenuBtn) mobMenuBtn.addEventListener("click", () => document.getElementById("main-nav").classList.toggle("open"));
document.getElementById("footer-whatsapp").addEventListener("click", e => {
  e.preventDefault();
  const msg = encodeURIComponent(`Olá! Vim do site ${CONFIG.storeName}.`);
  window.open(whatsappLink(msg).replace(/text=.*/, `text=${msg}`), "_blank");
});
document.getElementById("footer-instagram").addEventListener("click", e => {
  e.preventDefault();
  window.open(CONFIG.instagram, "_blank");
});

/* =====================================================
   MODAL — VISUALIZAÇÃO RÁPIDA
===================================================== */
function openModal(id) {
  const p = PRODUCTS.find(pr => pr.id === id);
  if (!p) return;
  const idx = PRODUCTS.indexOf(p);
  const img = p.image || placeholderImage(p.category, idx);
  const modal = document.getElementById("product-modal");
  modal.innerHTML = `
    <div class="modal-image"><img src="${img}" alt="${p.name}"></div>
    <div class="modal-body">
      <button class="modal-close" aria-label="Fechar">&times;</button>
      <span class="modal-cat">${labelCategory(p.category)}</span>
      <h3 class="modal-name">${p.name}</h3>
      <span class="modal-price">${money(p.price)}</span>
      <p class="modal-desc">${p.description}</p>
      <div class="modal-specs">
        <span>Tamanho: ${p.size}</span>
        <span>Estado de conservação: ${p.condition}</span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modal-add">Adicionar ao carrinho</button>
        <a class="btn btn-outline" id="modal-whatsapp" href="#">Perguntar no WhatsApp</a>
      </div>
    </div>
  `;
  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.querySelector("#modal-add").addEventListener("click", () => {
    addToCart(p.id, 1);
    showToast("Adicionado ao carrinho");
    closeModal();
    openCart();
  });
  modal.querySelector("#modal-whatsapp").addEventListener("click", e => {
    e.preventDefault();
    const msg = encodeURIComponent(`Olá! Tenho interesse na peça "${p.name}" (Tam. ${p.size}) do site ${CONFIG.storeName}. Ainda está disponível?`);
    window.open(whatsappLink(msg).replace(/text=.*/, `text=${msg}`), "_blank");
  });

  document.getElementById("modal-overlay").classList.add("open");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}
document.getElementById("modal-overlay").addEventListener("click", e => {
  if (e.target.id === "modal-overlay") closeModal();
});

/* =====================================================
   TOAST
===================================================== */
let toastTimer;
function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

/* =====================================================
   INIT
===================================================== */
document.getElementById("year").textContent = new Date().getFullYear();
buildCircuitRing();
buildBarcode();
renderGrid();
updateCartUI();
