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
  return subtotal < SHIPPING_THRESHOLD ? SHIPPING_HIGH : SHIPPING_LOW;
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
    "ck-bairro": saved.bairro, "ck-cidade": saved.cidade, "ck-uf": saved.uf, "ck-complemento": saved.complemento
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

/* Máscara de CEP + autopreenchimento de endereço via ViaCEP. Só busca
   quando os 8 dígitos estiverem completos; número e complemento
   continuam manuais (a API não sabe disso). */
async function lookupCep(cep) {
  const spinner = document.getElementById("ck-cep-spinner");
  spinner.hidden = false;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await res.json();
    if (data.erro) {
      showToast("CEP não encontrado — preencha o endereço manualmente.");
      return;
    }
    document.getElementById("ck-logradouro").value = data.logradouro || "";
    document.getElementById("ck-bairro").value = data.bairro || "";
    document.getElementById("ck-cidade").value = data.localidade || "";
    document.getElementById("ck-uf").value = data.uf || "";
    document.getElementById("ck-numero").focus();
  } catch (err) {
    console.error("Busca de CEP:", err);
    showToast("Não foi possível buscar o CEP — preencha o endereço manualmente.");
  } finally {
    spinner.hidden = true;
    maybeCalculateShipping();
  }
}

document.getElementById("ck-cep").addEventListener("input", e => {
  let v = e.target.value.replace(/\D/g, "").slice(0, 8);
  const digits = v;
  if (v.length > 5) v = `${v.slice(0, 5)}-${v.slice(5)}`;
  e.target.value = v;
  maybeCalculateShipping();
  if (digits.length === 8) lookupCep(digits);
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
  "ck-logradouro", "ck-numero", "ck-bairro", "ck-cidade", "ck-uf"
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

/* Pagamento — Cartão e Pix usam o mesmo link hospedado pela
   InfinitePay; o cliente escolhe a forma exata (cartão ou Pix) na
   própria página deles. */
document.getElementById("checkout-payment-pills").addEventListener("click", e => {
  const pill = e.target.closest("[data-payment]");
  if (!pill) return;
  checkoutPayment = pill.dataset.payment;
  document.querySelectorAll("#checkout-payment-pills .pill").forEach(p => p.classList.toggle("active", p === pill));
});

/* Mensagem de WhatsApp — só usada se a geração do link de pagamento
   falhar (fallback pra nunca travar a compra do cliente). */
function buildOrderWhatsappMessage(order) {
  let msg = `Olá! Sou ${order.customer.nome} e quero pagar o pedido *${order.id}* do site *${CONFIG.storeName}*:\n\n`;
  order.items.forEach(item => {
    msg += `• ${item.name} (Tam. ${item.size}) x${item.qty} — ${money(item.price * item.qty)}\n`;
  });
  msg += `\nSubtotal: ${money(order.subtotal)}\nFrete: ${money(order.shipping)}\n*Total: ${money(order.total)}*\n\nPodemos combinar o pagamento pelo cartão?`;
  return encodeURIComponent(msg);
}

/* Alerta o admin por e-mail (Resend) assim que um pedido é criado —
   não é confirmação de pagamento (isso é o webhook da InfinitePay),
   é só "um cliente acabou de fechar o pedido". Nunca trava nem atrasa
   o checkout: dispara em segundo plano, sem esperar a resposta. */
function notifyAdminNewOrder(order) {
  const itemsHtml = order.items
    .map(i => `<p style="margin:0 0 6px;">• ${i.name} (Tam. ${i.size}) x${i.qty} — ${money(i.price * i.qty)}</p>`)
    .join("");
  const html = `<!doctype html>
    <html><head><meta charset="UTF-8"></head>
    <body style="margin:0;">
    <div style="background:#0e0e0e;padding:32px 16px;font-family:'Courier New',monospace;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border:2px solid #161616;border-radius:10px;padding:28px;">
        <p style="font-family:monospace;font-weight:bold;font-size:15px;letter-spacing:1px;margin:0 0 20px;">RE<span style="color:#2f8f4e;">.</span>CYBER</p>
        <h1 style="font-size:14px;letter-spacing:.5px;margin:0 0 16px;">Novo pedido recebido — ${order.id}</h1>
        <div style="font-size:14px;line-height:1.6;color:#161616;">
          <p style="margin:0 0 10px;"><strong>Cliente:</strong> ${order.customer.nome} (${order.customer.email} · ${order.customer.telefone})</p>
          <p style="margin:0 0 10px;"><strong>Pagamento escolhido:</strong> ${order.payment === "cartao" ? "Cartão de Crédito" : "Pix"}</p>
          ${itemsHtml}
          <p style="margin:10px 0 0;"><strong>Total: ${money(order.total)}</strong></p>
        </div>
        <hr style="border:none;border-top:1px solid #dededd;margin:24px 0 16px;">
        <p style="font-size:11px;color:#8a8a86;margin:0;">Re.cyber — Slow Fashion Brechó · recyber.com.br</p>
      </div>
    </div>
    </body></html>`;

  fetch("/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: CONFIG.adminEmail, subject: `Novo pedido recebido — ${order.id}`, html })
  }).catch(err => console.warn("Alerta de novo pedido:", err));
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
    discount,
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
      cidade: document.getElementById("ck-cidade").value.trim(),
      uf: document.getElementById("ck-uf").value.trim().toUpperCase(),
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
  if (!ok) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Finalizar Compra";
    return;
  }

  saveCustomerProfile(order.customer);
  notifyAdminNewOrder(order);

  /* Cartão de crédito e Pix: gera o link de pagamento hospedado pela
     InfinitePay (o cliente escolhe a forma exata na página deles) e
     manda ele pra lá. Se der qualquer problema (fora do ar, bloqueio,
     etc.), cai pro fluxo antigo — combinar o pagamento por WhatsApp —
     pra nunca travar a compra do cliente. */
  submitBtn.textContent = "Gerando link de pagamento...";
  try {
    const res = await fetch("/api/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      state.cart = [];
      saveCart();
      appliedCoupon = "";
      window.location.href = data.url;
      return;
    }
    console.error("create-payment indisponível, caindo pro WhatsApp:", data);
  } catch (err) {
    console.error("create-payment falhou, caindo pro WhatsApp:", err);
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Finalizar Compra";

  state.cart = [];
  saveCart();
  appliedCoupon = "";

  closeCheckout();
  document.getElementById("success-overlay").classList.add("open");

  showToast("Não conseguimos gerar o link de pagamento automático — vamos combinar pelo WhatsApp.");
  window.open(whatsappLink(buildOrderWhatsappMessage(order)), "_blank");
});

/* Cliente volta do checkout da InfinitePay (redirect_url=/?pedido=ID)
   depois de pagar — o webhook já confirma o pagamento no servidor;
   aqui é só avisar visualmente que deu certo. */
(function handlePaymentRedirect() {
  const params = new URLSearchParams(window.location.search);
  const pedido = params.get("pedido");
  if (!pedido) return;
  document.getElementById("success-text").textContent =
    "Parabéns pela compra! Seu código de rastreio será enviado por e-mail assim que o produto for postado. Fique de olho: ele pode ir para a caixa de spam ou lixo eletrônico. O e-mail será enviado pela Melhor Envio.";
  document.getElementById("success-overlay").classList.add("open");
  params.delete("pedido");
  const rest = params.toString();
  history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
})();

function closeSuccess() {
  document.getElementById("success-overlay").classList.remove("open");
  document.getElementById("success-text").textContent =
    "Seu pedido foi finalizado! Aguarde o código de rastreio e atualização do status do seu pedido no e-mail.";
}
document.getElementById("success-close").addEventListener("click", closeSuccess);
document.getElementById("success-ok").addEventListener("click", closeSuccess);
document.getElementById("success-overlay").addEventListener("click", e => {
  if (e.target.id === "success-overlay") closeSuccess();
});
