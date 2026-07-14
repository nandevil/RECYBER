/* =====================================================
   SUPABASE — configuração do back-end na nuvem
   Enquanto os dois campos abaixo estiverem vazios, o site funciona no
   modo local (pedidos no localStorage deste navegador, login do painel
   por senha com hash). Preencha com os dados do seu projeto Supabase
   (veja SUPABASE.md na raiz do projeto) para ativar o modo nuvem:
   pedidos centralizados e login validado no servidor.

   A "anon key" é pública por design (ela vai no front-end de qualquer
   site que usa Supabase); a proteção dos dados vem das políticas RLS
   criadas no SUPABASE.md, não do sigilo da chave.
===================================================== */
const SUPABASE_URL = "https://pzsbmenyseilagvbrnxn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BkAXxQr7X3NXplTcG6TrWw_Pj92RLPJ";

const sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function supabaseEnabled() {
  return !!sb;
}

/* Conversão entre o formato do site (camelCase) e o banco (snake_case) */
function orderToRow(o) {
  return {
    id: o.id,
    items: o.items,
    subtotal: o.subtotal,
    shipping: o.shipping,
    total: o.total,
    customer: o.customer,
    marketing_opt_in: o.marketingOptIn,
    payment: o.payment,
    payment_status: o.paymentStatus,
    status: o.status
  };
}

function rowToOrder(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    items: r.items,
    subtotal: Number(r.subtotal),
    shipping: Number(r.shipping),
    total: Number(r.total),
    customer: r.customer,
    marketingOptIn: r.marketing_opt_in,
    payment: r.payment,
    paymentStatus: r.payment_status,
    status: r.status
  };
}

/* Peça cadastrada no painel (tabela public.products) -> formato do catálogo */
function rowToProduct(r) {
  const images = Array.isArray(r.image_urls) ? r.image_urls : [];
  return {
    id: r.id,
    category: r.category,
    name: r.name,
    price: Number(r.price) || 0,
    size: r.size || "Único",
    condition: r.condition || "",
    description: r.description || "",
    image: images[0] || "",
    images,
    tag: r.tag || "",
    empty: false
  };
}

/* Depoimento cadastrado no painel (tabela public.feedbacks) -> formato do card */
function rowToFeedback(r) {
  return {
    id: r.id,
    name: r.name,
    comment: r.comment,
    rating: Number(r.rating) || 5,
    photo: r.photo_url || ""
  };
}

/* Textos do modal "Informações" (tabela public.site_settings, linha única id=1) */
function rowToSettings(r) {
  return {
    envios: r.envios_text || "",
    pagamentos: r.pagamentos_text || "",
    devolucao: r.devolucao_text || ""
  };
}
