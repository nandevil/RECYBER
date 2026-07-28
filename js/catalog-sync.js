/* =====================================================
   CATÁLOGO DINÂMICO — carrega as peças cadastradas no painel
   (Supabase) e preenche o catálogo público. Roda para TODO visitante
   do site (não só o admin), pois o catálogo é público. Sem Supabase
   configurado, ou sem a tabela "products" ainda criada, o catálogo
   simplesmente fica vazio (cada categoria mostra o estado "nenhuma
   peça disponível").
===================================================== */
async function fetchRealProducts() {
  if (!supabaseEnabled()) return [];
  const { data, error } = await sb.from("products").select("*").order("created_at", { ascending: false });
  if (error) {
    // Tabela ainda não existe (SUPABASE.md, Passo 5) ou outro erro de rede — modo silencioso.
    console.warn("Catálogo dinâmico indisponível:", error.message);
    return [];
  }
  return data.map(rowToProduct);
}

/* Abre automaticamente a peça indicada em "?produto=ID" na URL — usado
   pelo feed de produtos (/feed.xml, worker.js) pra levar quem clica no
   Instagram/TikTok direto pra peça certa, não só pra home. Só tenta
   uma vez (senão reabriria toda vez que o catálogo resincroniza). */
let didOpenProductFromUrl = false;
function openProductFromUrlIfNeeded() {
  if (didOpenProductFromUrl) return;
  const id = new URLSearchParams(window.location.search).get("produto");
  if (!id) return;
  didOpenProductFromUrl = true;
  if (typeof openModal === "function") openModal(id);
}

async function syncCatalog() {
  const real = await fetchRealProducts();
  PRODUCTS.length = 0;
  PRODUCTS.push(...real);
  renderCategoryCards();
  renderGrid();
  openProductFromUrlIfNeeded();
}

syncCatalog();
