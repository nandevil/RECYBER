/* =====================================================
   CHECKOUT — formulário de envio, frete, pagamento e pedido
   Depende de: CONFIG, PRODUCTS, state, money(), cartTotal(),
   whatsappLink(), showToast(), closeCart() (definidos em js/app.js)
===================================================== */
const ORDERS_KEY = "recyber_orders";

function getOrders() {
  return JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]");
}
function saveOrders(orders) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

/* Regra de frete — não exibida ao cliente, só o valor final. Frete
   grátis (configurado no painel) sobrepõe o cálculo normal. */
function calcShipping(subtotal) {
  if (typeof isFreeShippingEligible === "function" && isFreeShippingEligible()) return 0;
  return subtotal < 169 ? 18 : 10;
}

let checkoutPayment = null;
let shippingCalculated = false;

function renderCheckoutSummary() {
  const wrap = document.getElementById("checkout-summary");
  wrap.innerHTML = state.cart.map(item => {
    const p = PRODUCTS.find(pr => pr.id === item.id);
    if (!p) return "";
    return `<div class="checkout-summary-row">
      <span>${p.name} <em>Tam. ${p.size}</em> x${item.qty}</span>
      <span>${money(effectivePrice(p) * item.qty)}</span>
    </div>`;
  }).join("");
}

function resetCheckoutForm() {
  document.getElementById("checkout-form").reset();
  document.getElementById("checkout-totals").hidden = true;
  document.getElementById("pix-card").hidden = true;
  document.querySelectorAll("#checkout-payment-pills .pill").forEach(p => p.classList.remove("active"));
  checkoutPayment = null;
  shippingCalculated = false;
}

/* Preenchimento automático — sem login/conta: guarda os dados do
   cliente no localStorage do próprio aparelho após uma compra, e
   preenche de novo na próxima visita NESTE MESMO dispositivo. Não
   sincroniza entre aparelhos diferentes (isso exigiria contas de
   cliente de verdade via Supabase Auth, com todo o trabalho de
   segurança que isso implica — fora do escopo aqui). */
const CUSTOMER_PROFILE_KEY = "recyber_customer_profile";

function saveCustomerProfile(customer) {
  localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(customer));
}

function fillSavedCustomerData() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(CUSTOMER_PROFILE_KEY) || "null"); } catch { saved = null; }
  if (!saved) return;
  const fields = {
    "ck-cep": saved.cep, "ck-nome": saved.nome, "ck-email": saved.email, "ck-cpf": saved.cpf,
    "ck-telefone": saved.telefone, "ck-logradouro": saved.logradouro, "ck-numero": saved.numero,
    "ck-bairro": saved.bairro, "ck-complemento": saved.complemento
  };
  Object.entries(fields).forEach(([id, value]) => {
    if (value) document.getElementById(id).value = value;
  });
  maybeCalculateShipping();
}

function openCheckout() {
  renderCheckoutSummary();
  resetCheckoutForm();
  fillSavedCustomerData();
  document.getElementById("checkout-overlay").classList.add("open");
}
function closeCheckout() {
  document.getElementById("checkout-overlay").classList.remove("open");
}

document.getElementById("checkout-close").addEventListener("click", closeCheckout);
document.getElementById("checkout-overlay").addEventListener("click", e => {
  if (e.target.id === "checkout-overlay") closeCheckout();
});

/* Máscaras simples de CEP e CPF */
document.getElementById("ck-cep").addEventListener("input", e => {
  let v = e.target.value.replace(/\D/g, "").slice(0, 8);
  if (v.length > 5) v = `${v.slice(0, 5)}-${v.slice(5)}`;
  e.target.value = v;
  maybeCalculateShipping();
});
document.getElementById("ck-cpf").addEventListener("input", e => {
  let v = e.target.value.replace(/\D/g, "").slice(0, 11);
  if (v.length > 9) v = `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  else if (v.length > 6) v = `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`;
  else if (v.length > 3) v = `${v.slice(0, 3)}.${v.slice(3)}`;
  e.target.value = v;
});

const SHIPPING_REQUIRED_IDS = [
  "ck-cep", "ck-nome", "ck-email", "ck-cpf", "ck-telefone",
  "ck-logradouro", "ck-numero", "ck-bairro"
];

function shippingFieldsFilled() {
  return SHIPPING_REQUIRED_IDS.every(id => document.getElementById(id).value.trim() !== "")
    && document.getElementById("ck-cep").value.replace(/\D/g, "").length === 8;
}

function maybeCalculateShipping() {
  const totalsBox = document.getElementById("checkout-totals");
  if (!shippingFieldsFilled()) {
    totalsBox.hidden = true;
    shippingCalculated = false;
    return;
  }
  totalsBox.hidden = false;
  document.getElementById("ck-frete").textContent = "Calculando...";
  shippingCalculated = false;
  setTimeout(() => {
    const subtotal = cartTotal();
    const discount = typeof cartDiscountAmount === "function" ? cartDiscountAmount() : 0;
    const shipping = calcShipping(subtotal);
    document.getElementById("ck-subtotal").textContent = money(subtotal);
    document.getElementById("ck-discount-row").hidden = discount <= 0;
    if (discount > 0) document.getElementById("ck-discount").textContent = `-${money(discount)}`;
    document.getElementById("ck-frete").textContent = money(shipping);
    document.getElementById("ck-total").textContent = money(subtotal - discount + shipping);
    shippingCalculated = true;
  }, 500);
}

SHIPPING_REQUIRED_IDS.forEach(id => {
  document.getElementById(id).addEventListener("blur", maybeCalculateShipping);
});

/* Pagamento */
document.getElementById("checkout-payment-pills").addEventListener("click", e => {
  const pill = e.target.closest("[data-payment]");
  if (!pill) return;
  checkoutPayment = pill.dataset.payment;
  document.querySelectorAll("#checkout-payment-pills .pill").forEach(p => p.classList.toggle("active", p === pill));
  document.getElementById("pix-card").hidden = checkoutPayment !== "pix";
});

/* Mensagem de WhatsApp para pagamento no Cartão de Crédito */
function buildOrderWhatsappMessage(order) {
  let msg = `Olá! Sou ${order.customer.nome} e quero pagar com cartão o pedido *${order.id}* do site *${CONFIG.storeName}*:\n\n`;
  order.items.forEach(item => {
    msg += `• ${item.name} (Tam. ${item.size}) x${item.qty} — ${money(item.price * item.qty)}\n`;
  });
  msg += `\nSubtotal: ${money(order.subtotal)}\nFrete: ${money(order.shipping)}\n*Total: ${money(order.total)}*\n\nPodemos combinar o pagamento pelo cartão?`;
  return encodeURIComponent(msg);
}

/* Persiste o pedido: Supabase quando configurado, senão localStorage. */
async function persistOrder(order) {
  if (supabaseEnabled()) {
    const { error } = await sb.from("orders").insert(orderToRow(order));
    if (error) {
      console.error("Supabase insert:", error);
      showToast("Erro ao registrar o pedido. Tente novamente.");
      return false;
    }
    return true;
  }
  const orders = getOrders();
  orders.push(order);
  saveOrders(orders);
  return true;
}

/* Finalizar compra */
document.getElementById("checkout-form").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target;

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  if (!shippingCalculated) {
    showToast("Preencha o CEP e o endereço para calcular o frete");
    return;
  }
  if (!checkoutPayment) {
    showToast("Escolha uma forma de pagamento");
    return;
  }

  const subtotal = cartTotal();
  const discount = typeof cartDiscountAmount === "function" ? cartDiscountAmount() : 0;
  const shipping = calcShipping(subtotal);

  const order = {
    id: `RC-${Date.now()}`,
    createdAt: new Date().toISOString(),
    items: state.cart.map(item => {
      const p = PRODUCTS.find(pr => pr.id === item.id);
      return p ? { id: p.id, name: p.name, size: p.size, qty: item.qty, price: effectivePrice(p), image: p.image || "" } : null;
    }).filter(Boolean),
    subtotal,
    shipping,
    total: subtotal - discount + shipping,
    customer: {
      cep: document.getElementById("ck-cep").value.trim(),
      nome: document.getElementById("ck-nome").value.trim(),
      email: document.getElementById("ck-email").value.trim(),
      cpf: document.getElementById("ck-cpf").value.trim(),
      telefone: document.getElementById("ck-telefone").value.trim(),
      logradouro: document.getElementById("ck-logradouro").value.trim(),
      numero: document.getElementById("ck-numero").value.trim(),
      bairro: document.getElementById("ck-bairro").value.trim(),
      complemento: document.getElementById("ck-complemento").value.trim()
    },
    marketingOptIn: document.getElementById("ck-marketing").checked,
    payment: checkoutPayment,
    paymentStatus: "pendente",
    status: "recebido"
  };

  const submitBtn = document.getElementById("checkout-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando...";
  const ok = await persistOrder(order);
  submitBtn.disabled = false;
  submitBtn.textContent = "Finalizar Compra";
  if (!ok) return;

  saveCustomerProfile(order.customer);
  state.cart = [];
  saveCart();
  appliedCoupon = "";

  closeCheckout();
  document.getElementById("success-overlay").classList.add("open");

  if (checkoutPayment === "cartao") {
    window.open(whatsappLink(buildOrderWhatsappMessage(order)), "_blank");
  }
});

function closeSuccess() {
  document.getElementById("success-overlay").classList.remove("open");
}
document.getElementById("success-close").addEventListener("click", closeSuccess);
document.getElementById("success-ok").addEventListener("click", closeSuccess);
document.getElementById("success-overlay").addEventListener("click", e => {
  if (e.target.id === "success-overlay") closeSuccess();
});
