/* =====================================================
   CONFIGURAÇÃO DA LOJA — edite aqui
===================================================== */
const CONFIG = {
  whatsappNumber: "5522999390065", // DDI+DDD+numero, só dígitos
  instagram: "https://instagram.com/re.cyber",
  tiktok: "https://tiktok.com/@re.cyber", // troque pelo usuário real
  storeName: "Re.cyber",
  adminEmail: "anandalage18@hotmail.com" // recebe o alerta de "novo pedido" (js/checkout.js)
};

/* Frete padrão (sem campanha de frete grátis ativa) — usado aqui pro
   incentivo no carrinho e em js/checkout.js pro cálculo real. Abaixo
   de SHIPPING_THRESHOLD cobra SHIPPING_HIGH; a partir daí (inclusive),
   SHIPPING_LOW — só mudar os números aqui pra ajustar a regra. */
const SHIPPING_THRESHOLD = 169;
const SHIPPING_HIGH = 18;
const SHIPPING_LOW = 10;

/* =====================================================
   PLACEHOLDER DE IMAGEM (SVG inline, sem dependência externa)
===================================================== */
const HANGER_PATH = "M8 4l4-2 4 2 3 3-3 2v11H5V9L2 7l3-3z";
const CATEGORY_ICON_PATHS = {
  camisas: HANGER_PATH,
  blusas: HANGER_PATH,
  saias: "M7 3h10l2 17H5L7 3zM9 3v5a3 3 0 006 0V3",
  vestidos: "M9 3h6l1 5-2 1 3 11H7l3-11-2-1 1-5z",
  shorts: "M4 4h16l-1 7-2 9h-4l-1-8-1 8H7L5 11 4 4z",
  calcas: "M6 3h12l1 18h-5l-1-11-1 11H7L6 3z",
  "casacos-sobreposicoes": HANGER_PATH,
  bolsas: "M6 8h12l1 13H5L6 8zM9 8a3 3 0 016 0",
  sapatos: "M4 15c0-2 1-3 3-4l6-3 2 2 5 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-1z",
  bermudas: "M5 4h14l-1 9-2 8h-4l-1-10-1 10H7l-2-8-1-9z",
  promocoes: "M12 2l2 5 5 .8-3.6 3.6.9 5.1L12 14l-4.3 2.5.9-5.1L5 8.8 10 8l2-6z"
};
const CATEGORY_BG = {
  camisas: "#dcdcd8",
  blusas: "#d9dbd6",
  saias: "#dbd6da",
  vestidos: "#ded6d9",
  shorts: "#d8dcd9",
  calcas: "#d6d9dc",
  "casacos-sobreposicoes": "#dad7d3",
  bolsas: "#d3d9d2",
  sapatos: "#dcd6d9",
  bermudas: "#d7dad6"
};

function placeholderImage(category, seed) {
  const bg = CATEGORY_BG[category] || "#d9d9d6";
  const path = CATEGORY_ICON_PATHS[category] || HANGER_PATH;
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
  filter: null, // null = tela de categorias · "todos" = todas as peças · id de categoria = filtrado
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

/* Escapa HTML antes de inserir texto que veio do cliente (nome,
   endereço, id do pedido, item do carrinho etc.) em qualquer innerHTML
   — usado em js/checkout.js e js/admin.js. Esses campos chegam do
   formulário público sem passar por validação de servidor (o Supabase
   aceita inserção anônima de pedidos com "with check(true)"), então
   tratamos como texto não confiável sempre que é exibido de volta,
   seja no e-mail de aviso pro dono ou no painel. Sem isso, alguém
   poderia colocar HTML/script no nome ou endereço do pedido. */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* =====================================================
   RENDER — GRID DE PRODUTOS
===================================================== */
function isProductView() {
  return !!state.filter || !!state.search.trim();
}

function getFilteredProducts() {
  if (!isProductView()) return [];

  const q = state.search.trim().toLowerCase();
  let list = PRODUCTS.filter(p => {
    const matchesFilter = !state.filter || state.filter === "todos"
      ? true
      : state.filter === "promocoes"
      ? (isPromoWindowOpen() && p.isPromo)
      : p.category === state.filter;
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.size.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  if (state.sort === "menor-preco") list = [...list].sort((a, b) => a.price - b.price);
  if (state.sort === "maior-preco") list = [...list].sort((a, b) => b.price - a.price);
  if (state.sort === "novidades") list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return list;
}

/* Home em formato marketplace: os atalhos de categoria (compactos, no
   topo) e a vitrine de produtos ficam sempre visíveis juntos — não
   existe mais uma "tela de categorias" separada da "tela de
   produtos". Só o título acima do grid muda conforme o filtro/busca. */
function updateCatalogView() {
  const isSearching = !!state.search.trim();
  document.getElementById("catalog-title").textContent = isSearching
    ? "Resultados da busca"
    : state.filter === "todos" ? "Todos"
    : state.filter ? labelCategory(state.filter)
    : "Todos";
}

function renderGrid() {
  const grid = document.getElementById("product-grid");
  const emptyState = document.getElementById("empty-state");
  const list = getFilteredProducts();
  const showProducts = isProductView();
  const isSearching = !!state.search.trim();

  grid.innerHTML = "";
  emptyState.hidden = !showProducts || list.length !== 0;
  emptyState.textContent = isSearching
    ? "Nenhuma peça encontrada. Tente outro filtro ou busca."
    : "Nenhuma peça disponível nesta categoria no momento. Volte em breve!";

  const NEW_BADGE_DAYS = 14;
  list.forEach((p, idx) => {
    const img = p.image || placeholderImage(p.category, idx);
    const onPromo = isPromoWindowOpen() && p.isPromo;
    /* "Novo" é calculado pela data de cadastro (peça recém-colocada),
       não por uma tag manual salva no banco — assim nunca fica "presa"
       em peças antigas nem precisa de limpeza manual. */
    const isNew = p.createdAt && (Date.now() - new Date(p.createdAt).getTime()) < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
    const badgeHtml = p.isSold
      ? ""
      : onPromo
      ? `<span class="product-badge product-badge--promo">-${promoState.discountPercent}%</span>`
      : (isNew ? `<span class="product-badge">Novo</span>` : "");
    const priceHtml = onPromo
      ? `<span class="product-price product-price--promo"><s class="product-price-original">${money(p.price)}</s>${money(effectivePrice(p))}</span>`
      : `<span class="product-price">${money(p.price)}</span>`;
    const soldOverlayHtml = p.isSold ? `<div class="product-sold-overlay"><span>Esgotado</span></div>` : "";
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-thumb" data-id="${p.id}">
        ${badgeHtml}
        ${soldOverlayHtml}
        <img src="${img}" alt="${p.name}" loading="lazy">
      </div>
      <div class="product-info">
        <span class="product-cat">${labelCategory(p.category)}</span>
        <p class="product-name" data-id="${p.id}">${p.name}</p>
        <span class="product-meta">Tam. ${p.size} · ${p.condition}</span>
        <div class="product-price-row">
          ${priceHtml}
          <button class="add-btn" data-id="${p.id}" aria-label="Adicionar ao carrinho" ${p.isSold ? "disabled" : ""}>${p.isSold ? "×" : "+"}</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".product-thumb, .product-name").forEach(el => {
    el.addEventListener("click", () => openModal(el.dataset.id));
  });
  grid.querySelectorAll(".add-btn:not(:disabled)").forEach(el => {
    el.addEventListener("click", () => {
      addToCart(el.dataset.id, 1);
      showToast("Adicionado ao carrinho");
    });
  });
}

function labelCategory(cat) {
  if (cat === "promocoes") return "Promoções";
  const found = CATEGORIES.find(c => c.id === cat);
  return found ? found.label : cat;
}

/* Seção "Fique por dentro da Re.cyber" (newsletter) — bloco único
   centralizado sempre; as cores já invertem sozinhas via
   body.promo-mode-active, essa classe só liga o efeito de glow no
   título durante a campanha. */
function renderNewsletterLayout() {
  const section = document.getElementById("newsletter");
  if (!section) return;
  section.classList.toggle("newsletter-section--promo", isPromoWindowOpen());
}

/* =====================================================
   CARDS DE CATEGORIA
===================================================== */
function renderCategoryCards() {
  const wrap = document.getElementById("category-cards");
  if (!wrap) return;
  const promoCount = PRODUCTS.filter(p => p.isPromo).length;
  const showPromo = isPromoWindowOpen() && promoCount > 0;
  /* Modo Promo ativo E com peças marcadas: funil de vendas — some com
     as demais categorias e deixa só "Promoções" visível. Sem nenhuma
     peça marcada, mostra o grid normal mesmo com o tema escuro ligado
     (classe abaixo controla o CSS que centraliza o card único — sem
     ela, o grid normal de categorias não deve virar flex). */
  wrap.classList.toggle("category-cards--promo-only", showPromo);
  const list = showPromo
    ? [{ id: "promocoes", label: "Promoções" }]
    : [{ id: "todos", label: "Todos" }, ...CATEGORIES];
  const cards = list.map(cat => {
    const catProducts = cat.id === "todos" || cat.id === "promocoes"
      ? []
      : PRODUCTS.filter(p => p.category === cat.id);
    const count = cat.id === "todos"
      ? PRODUCTS.length
      : cat.id === "promocoes"
      ? promoCount
      : catProducts.length;
    /* Prioridade da capa do card: (1) foto definida manualmente pro
       Emanuel(CATEGORY_COVERS, js/category-covers-sync.js), (2) foto da
       peça mais antiga da categoria (a "primeira colocada"), (3) ícone
       genérico. */
    const manualCover = typeof CATEGORY_COVERS !== "undefined" ? CATEGORY_COVERS[cat.id] : null;
    const oldestWithPhoto = catProducts
      .filter(p => p.image && p.createdAt)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    const iconPath = CATEGORY_ICON_PATHS[cat.id] || HANGER_PATH;
    const coverImage = manualCover || (oldestWithPhoto && oldestWithPhoto.image);
    const thumbHtml = coverImage
      ? `<img class="cat-card-photo" src="${coverImage}" alt="" loading="lazy">`
      : `<svg class="cat-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="${iconPath}"/></svg>`;
    return `
      <button class="cat-card${cat.id === "promocoes" ? " cat-card--promo" : ""}${cat.id === state.filter ? " active" : ""}" data-filter="${cat.id}">
        <span class="cat-card-thumb">
          ${thumbHtml}
        </span>
        <span class="cat-card-info">
          <span class="cat-card-label">${cat.label}</span>
          <span class="cat-card-count">${count} peças</span>
        </span>
      </button>
    `;
  }).join("");
  wrap.innerHTML = cards;
}

/* =====================================================
   ROTEAMENTO POR HASH (#catalogo | #categoria-<id>)
===================================================== */
function filterToHash(filter) {
  return filter ? `#categoria-${filter}` : "#catalogo";
}

function hashToFilter() {
  const m = window.location.hash.match(/^#categoria-(.+)$/);
  if (!m) return null;
  const id = m[1];
  if (id === "todos" || CATEGORIES.some(c => c.id === id)) return id;
  if (id === "promocoes" && isPromoWindowOpen()) return id;
  return null;
}

/* =====================================================
   FILTROS / BUSCA / ORDENAÇÃO
===================================================== */
function setFilter(filter, opts = {}) {
  state.filter = filter || "todos";
  document.querySelectorAll("[data-filter]").forEach(c => c.classList.toggle("active", c.dataset.filter === filter));
  renderGrid();
  updateCatalogView();
  if (!opts.skipHash) {
    const hash = filterToHash(filter);
    if (window.location.hash !== hash) history.pushState(null, "", hash);
  }
}

document.getElementById("category-cards").addEventListener("click", e => {
  const el = e.target.closest("[data-filter]");
  if (el) setFilter(el.dataset.filter);
});
document.querySelectorAll("[data-filter]").forEach(el => {
  el.addEventListener("click", e => {
    const f = el.dataset.filter;
    if (!f) return;
    if (el.tagName === "A") e.preventDefault();
    setFilter(f);
    document.getElementById("catalogo").scrollIntoView({ behavior: "smooth" });
  });
});
window.addEventListener("popstate", () => setFilter(hashToFilter(), { skipHash: true }));
window.addEventListener("hashchange", () => setFilter(hashToFilter(), { skipHash: true }));

/* Destaca o ícone correspondente à tela atual na barra inferior mobile. */
function updateMobileNavActive() {
  const hash = window.location.hash;
  const isCatalog = hash.startsWith("#catalogo") || hash.startsWith("#categoria-");
  document.getElementById("mob-nav-grid").classList.toggle("active", isCatalog);
}
window.addEventListener("hashchange", updateMobileNavActive);
updateMobileNavActive();

const mobInfoBtn = document.getElementById("mob-nav-info");
if (mobInfoBtn) mobInfoBtn.addEventListener("click", openInfo);

document.getElementById("sort-select").addEventListener("change", e => {
  state.sort = e.target.value;
  renderGrid();
});

const searchInput = document.getElementById("search-input");
searchInput.addEventListener("input", e => {
  state.search = e.target.value;
  renderGrid();
  updateCatalogView();
});

document.getElementById("search-toggle").addEventListener("click", () => {
  document.getElementById("search-bar").classList.add("open");
  searchInput.focus();
});
document.getElementById("search-close").addEventListener("click", () => {
  document.getElementById("search-bar").classList.remove("open");
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
    return p ? sum + effectivePrice(p) * item.qty : sum;
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
  const stickyBadge = document.getElementById("sticky-cart-count");
  if (stickyBadge) stickyBadge.textContent = n;
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
          <span class="cart-item-meta">Tam. ${p.size} · ${money(effectivePrice(p))}</span>
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

  const subtotal = cartTotal();
  const discount = typeof cartDiscountAmount === "function" ? cartDiscountAmount() : 0;
  document.getElementById("cart-subtotal").textContent = money(subtotal - discount);

  const discountRow = document.getElementById("cart-discount-row");
  const discountBanner = document.getElementById("cart-discount-banner");
  const couponBox = document.getElementById("cart-coupon");
  const shippingNote = document.getElementById("cart-free-shipping-note");

  /* Carrinho vazio (ou subtotal zerado) precisa ser a primeira
     checagem — some com toda a seção de frete/desconto pra não mostrar
     mensagem nenhuma sem itens de verdade no carrinho. */
  if (state.cart.length === 0 || subtotal <= 0) {
    discountRow.hidden = true;
    discountBanner.hidden = true;
    couponBox.hidden = true;
    shippingNote.hidden = true;
    return;
  }

  if (typeof cartDiscountState !== "undefined") {
    const eligible = typeof isCartDiscountEligible === "function" && isCartDiscountEligible();
    discountRow.hidden = !eligible;
    if (eligible) document.getElementById("cart-discount-amount").textContent = `-${money(discount)}`;
    discountBanner.hidden = !eligible;

    couponBox.hidden = !(cartDiscountState.active && cartDiscountState.requiresCoupon && !eligible);

    const freeShipping = typeof isFreeShippingEligible === "function" && isFreeShippingEligible();
    if (freeShipping) {
      shippingNote.hidden = false;
      shippingNote.innerHTML = "🚚 Frete grátis aplicado neste pedido!";
    } else if (cartDiscountState.freeShippingActive && cartDiscountState.freeShippingMinCart > subtotal) {
      shippingNote.hidden = false;
      shippingNote.innerHTML = `🚚 Faltam ${money(cartDiscountState.freeShippingMinCart - subtotal)} para o frete grátis!`;
    } else if (subtotal < SHIPPING_THRESHOLD) {
      const remaining = SHIPPING_THRESHOLD - subtotal;
      const progress = Math.min(100, Math.round((subtotal / SHIPPING_THRESHOLD) * 100));
      shippingNote.hidden = false;
      shippingNote.innerHTML = `🚚 O frete atual é ${money(SHIPPING_HIGH)}. Adicione mais ${money(remaining)} para o seu frete cair para ${money(SHIPPING_LOW)}!
        <span class="cart-shipping-progress"><span class="cart-shipping-progress-bar" style="width:${progress}%"></span></span>`;
    } else {
      shippingNote.hidden = false;
      shippingNote.innerHTML = `🎉 Parabéns! Você atingiu o valor necessário e seu frete caiu para ${money(SHIPPING_LOW)}!`;
    }
  } else {
    discountRow.hidden = true;
    discountBanner.hidden = true;
    couponBox.hidden = true;
    shippingNote.hidden = true;
  }
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

document.getElementById("cart-coupon-apply").addEventListener("click", () => {
  const input = document.getElementById("cart-coupon-input");
  applyCoupon(input.value);
  if (!isCartDiscountEligible()) showToast("Cupom inválido ou valor mínimo não atingido");
});
document.getElementById("cart-coupon-input").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); document.getElementById("cart-coupon-apply").click(); }
});
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
    msg += `• ${p.name} (Tam. ${p.size}) x${item.qty} — ${money(effectivePrice(p) * item.qty)}\n`;
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
  closeCart();
  if (typeof openCheckout === "function") openCheckout();
});

const stickyCart = document.getElementById("sticky-cart");
if (stickyCart) stickyCart.addEventListener("click", openCart);
const mobCartBtn = document.getElementById("mob-cart-btn");
if (mobCartBtn) mobCartBtn.addEventListener("click", openCart);
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
  const modal = document.getElementById("product-modal");

  const idx = PRODUCTS.indexOf(p);
  const gallery = Array.isArray(p.images) && p.images.length > 0 ? p.images : (p.image ? [p.image] : []);
  const img = gallery[0] || placeholderImage(p.category, idx);
  const soldOverlayHtml = p.isSold ? `<div class="product-sold-overlay"><span>Esgotado</span></div>` : "";
  const thumbsHtml = gallery.length > 1 ? `
    <div class="modal-gallery">
      ${gallery.map((src, i) => `<button type="button" class="modal-gallery-thumb${i === 0 ? " active" : ""}" data-src="${src}"><img src="${src}" alt=""></button>`).join("")}
    </div>` : "";
  modal.innerHTML = `
    <div class="modal-image">
      ${soldOverlayHtml}
      <img src="${img}" alt="${p.name}" id="modal-main-image">
      ${thumbsHtml}
    </div>
    <div class="modal-body">
      <button class="modal-close" aria-label="Fechar">&times;</button>
      <span class="modal-cat">${labelCategory(p.category)}</span>
      <h3 class="modal-name">${p.name}</h3>
      <span class="modal-price">${isPromoWindowOpen() && p.isPromo
        ? `<s class="modal-price-original">${money(p.price)}</s> ${money(effectivePrice(p))}`
        : money(p.price)}</span>
      <p class="modal-desc">${p.description}</p>
      <div class="modal-specs">
        <span>Tamanho: ${p.size}</span>
        <span>Estado de conservação: ${p.condition}</span>
      </div>
      <div class="modal-actions">
        ${p.isSold
          ? `<button class="btn btn-primary" disabled>Peça esgotada</button>`
          : `<button class="btn btn-primary" id="modal-add">Adicionar ao carrinho</button>`}
        <a class="btn btn-outline" id="modal-whatsapp" href="#">Perguntar no WhatsApp</a>
      </div>
    </div>
  `;
  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  const galleryEl = modal.querySelector(".modal-gallery");
  if (galleryEl) {
    galleryEl.addEventListener("click", e => {
      const thumb = e.target.closest(".modal-gallery-thumb");
      if (!thumb) return;
      document.getElementById("modal-main-image").src = thumb.dataset.src;
      galleryEl.querySelectorAll(".modal-gallery-thumb").forEach(t => t.classList.toggle("active", t === thumb));
    });
  }
  const modalAddBtn = modal.querySelector("#modal-add");
  if (modalAddBtn) {
    modalAddBtn.addEventListener("click", () => {
      addToCart(p.id, 1);
      showToast("Adicionado ao carrinho");
      closeModal();
      openCart();
    });
  }
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
   INFORMAÇÕES (Envios / Pagamentos / Devolução / Redes / Contato)
===================================================== */
function openInfo() {
  // Prefere os links cadastrados no painel (Textos do Modal); cai para
  // CONFIG quando o Supabase ainda não está configurado.
  const insta = (typeof siteSettingsCache !== "undefined" && siteSettingsCache && siteSettingsCache.instagram) || CONFIG.instagram;
  const tiktok = (typeof siteSettingsCache !== "undefined" && siteSettingsCache && siteSettingsCache.tiktok) || CONFIG.tiktok;
  document.getElementById("info-instagram").href = insta;
  document.getElementById("info-tiktok").href = tiktok;
  const msg = encodeURIComponent(`Olá! Vim do site ${CONFIG.storeName} e preciso de suporte.`);
  document.getElementById("info-contato-link").href = whatsappLink(msg);
  document.getElementById("info-overlay").classList.add("open");
}
function closeInfo() {
  document.getElementById("info-overlay").classList.remove("open");
}

const stickyInfo = document.getElementById("sticky-info");
if (stickyInfo) stickyInfo.addEventListener("click", openInfo);
document.getElementById("info-close").addEventListener("click", closeInfo);
document.getElementById("info-overlay").addEventListener("click", e => {
  if (e.target.id === "info-overlay") closeInfo();
});

document.getElementById("info-pills").addEventListener("click", e => {
  const pill = e.target.closest("[data-info]");
  if (!pill) return;
  const key = pill.dataset.info;
  const card = document.getElementById(`info-card-${key}`);
  const isOpen = !card.hidden;

  document.querySelectorAll("#info-pills .pill[data-info]").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".info-card").forEach(c => (c.hidden = true));

  if (!isOpen) {
    card.hidden = false;
    pill.classList.add("active");
  }
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
state.filter = hashToFilter() || "todos";
renderCategoryCards();
renderGrid();
updateCatalogView();
updateCartUI();
