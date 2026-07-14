/* =====================================================
   CAMPANHA DE DESCONTO — carrega a campanha global (Supabase) e
   calcula, para cada peça marcada com "Modo Promo" no painel, se o
   desconto está valendo agora (campanha ativa + dentro do período).
   Sem Supabase configurado, ou sem a tabela "promo_settings" ainda
   criada, a campanha fica sempre inativa (modo silencioso) — preços
   normais, sem categoria "Promoções".
===================================================== */
let promoState = { active: false, discountPercent: 0, startDate: null, endDate: null };

function isPromoWindowOpen() {
  if (!promoState.active) return false;
  const now = new Date();
  if (promoState.startDate && now < new Date(promoState.startDate)) return false;
  if (promoState.endDate && now > new Date(promoState.endDate)) return false;
  return true;
}

/* Preço final de uma peça, já considerando o desconto quando aplicável. */
function effectivePrice(p) {
  if (!isPromoWindowOpen() || !p.isPromo) return p.price;
  return p.price * (1 - promoState.discountPercent / 100);
}

async function fetchPromoSettings() {
  if (!supabaseEnabled()) return null;
  const { data, error } = await sb.from("promo_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) console.warn("Campanha de desconto indisponível:", error.message);
    return null;
  }
  return rowToPromoSettings(data);
}

async function syncPromoState() {
  const settings = await fetchPromoSettings();
  if (settings) promoState = settings;
  if (typeof renderCategoryCards === "function") renderCategoryCards();
  if (typeof renderGrid === "function") renderGrid();
}

syncPromoState();
