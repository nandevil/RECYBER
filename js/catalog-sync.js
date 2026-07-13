/* =====================================================
   CATÁLOGO DINÂMICO — mescla peças cadastradas no painel (Supabase)
   com os espaços em branco do catálogo estático (js/products.js).
   Roda para TODO visitante do site (não só o admin), pois o catálogo
   é público. Sem Supabase configurado, ou sem a tabela "products"
   ainda criada, o site simplesmente continua só com os espaços vazios.
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

/* Substitui espaços vazios pelas peças reais de cada categoria,
   mantendo os ~32 espaços por categoria para quem ainda não cadastrou. */
function mergeRealProductsIntoCatalog(realProducts) {
  CATEGORIES.forEach(cat => {
    const real = realProducts.filter(p => p.category === cat.id);
    if (real.length === 0) return;

    const emptyIdxs = [];
    PRODUCTS.forEach((p, i) => { if (p.category === cat.id && p.empty) emptyIdxs.push(i); });

    real.forEach((p, i) => {
      if (i < emptyIdxs.length) PRODUCTS[emptyIdxs[i]] = p;
      else PRODUCTS.push(p);
    });
  });
}

async function syncCatalog() {
  const real = await fetchRealProducts();
  if (real.length === 0) return;
  mergeRealProductsIntoCatalog(real);
  renderCategoryCards();
  renderGrid();
}

syncCatalog();
