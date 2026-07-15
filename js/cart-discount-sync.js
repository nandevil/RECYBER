/* =====================================================
   DESCONTO NO CARRINHO + FRETE GRÁTIS — carrega as regras configuradas
   no painel (tabela public.cart_discounts) e calcula, em tempo real no
   navegador do cliente, se o carrinho atual se qualifica. Sem Supabase
   configurado, ou sem a tabela ainda criada, fica sempre desativado
   (modo silencioso) — carrinho funciona normal, sem desconto.
===================================================== */
let cartDiscountState = {
  active: false, type: "percent", value: 0, minCart: 0,
  requiresCoupon: false, couponCode: "",
  freeShippingActive: false, freeShippingMinCart: 0
};
let appliedCoupon = "";

async function fetchCartDiscountSettings() {
  if (!supabaseEnabled()) return null;
  const { data, error } = await sb.from("cart_discounts").select("*").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) console.warn("Descontos do carrinho indisponíveis:", error.message);
    return null;
  }
  return rowToCartDiscount(data);
}

/* O desconto vale quando: está ativo, o carrinho atingiu o mínimo, e
   (se exigir cupom) o código digitado bate com o cadastrado. */
function isCartDiscountEligible() {
  if (!cartDiscountState.active) return false;
  const subtotal = cartTotal();
  if (subtotal < cartDiscountState.minCart) return false;
  if (cartDiscountState.requiresCoupon) {
    return !!appliedCoupon && appliedCoupon === cartDiscountState.couponCode;
  }
  return true;
}

function cartDiscountAmount() {
  if (!isCartDiscountEligible()) return 0;
  const subtotal = cartTotal();
  const raw = cartDiscountState.type === "fixed"
    ? cartDiscountState.value
    : subtotal * (cartDiscountState.value / 100);
  return Math.min(raw, subtotal);
}

function isFreeShippingEligible() {
  return cartDiscountState.freeShippingActive && cartTotal() >= cartDiscountState.freeShippingMinCart;
}

function applyCoupon(code) {
  appliedCoupon = (code || "").trim().toUpperCase();
  if (typeof updateCartUI === "function") updateCartUI();
}

async function syncCartDiscountSettings() {
  const settings = await fetchCartDiscountSettings();
  if (settings) cartDiscountState = settings;
  if (typeof updateCartUI === "function") updateCartUI();
}

syncCartDiscountSettings();
