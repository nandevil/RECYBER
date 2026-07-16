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

async function syncCatalog() {
  const real = await fetchRealProducts();
  PRODUCTS.length = 0;
  PRODUCTS.push(...real);
  renderCategoryCards();
  renderGrid();
  if (typeof renderPromoDestaque === "function") renderPromoDestaque();
}

syncCatalog();
