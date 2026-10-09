/* =====================================================
   CATÁLOGO DINÂMICO — carrega as peças cadastradas no painel
   (Supabase) e preenche o catálogo público. Roda para TODO visitante
   do site (não só o admin), pois o catálogo é público. Sem Supabase
   configurado, ou sem a tabela "products" ainda criada, o catálogo
   simplesmente fica vazio (cada categoria mostra o estado "nenhuma
   peça disponível").
===================================================== */
/* Visitante comum lê o catálogo de /api/catalog (Worker, cache de borda
   de ~60s) em vez de bater no Supabase a cada visita — poupa a cota de
   tráfego do plano Free em dia de promoção. O dono logado (painel) e
   qualquer falha do Worker caem na leitura direta, sempre atualizada. */
async function fetchRealProducts() {
  if (!supabaseEnabled()) return [];

  const ownerLoggedIn = Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k));
  if (!ownerLoggedIn) {
    try {
      const res = await fetch("/api/catalog");
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) return rows.map(rowToProduct);
      }
    } catch (_) { /* cai pra leitura direta abaixo */ }
  }

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

/* Tempo real: quando uma peça é marcada como vendida (pagamento
   confirmado, automático ou manual pelo painel) ou qualquer outra
   mudança no catálogo, quem já está com o site aberto vê a atualização
   sozinho — sem isso, "Esgotado" só aparecia depois de um F5 manual.
   Exige Realtime ligado na tabela "products" (SUPABASE.md, Passo 28).
   Mesmo padrão do Realtime de pedidos no painel (js/admin.js). */
/* Aplica só a linha que mudou (vem pronta no evento do Realtime) em vez
   de baixar o catálogo inteiro de novo: antes, cada venda fazia TODO
   visitante online rebaixar ~26 KB. Se o evento vier incompleto, cai no
   recarregamento completo. */
function applyCatalogChange(payload) {
  try {
    const type = payload.eventType;
    if (type === "DELETE") {
      const id = payload.old && payload.old.id;
      if (!id) return syncCatalog();
      const i = PRODUCTS.findIndex(p => p.id === id);
      if (i >= 0) PRODUCTS.splice(i, 1);
    } else {
      if (!payload.new || !payload.new.id) return syncCatalog();
      const product = rowToProduct(payload.new);
      const i = PRODUCTS.findIndex(p => p.id === product.id);
      if (i >= 0) PRODUCTS[i] = product;
      else PRODUCTS.unshift(product);
    }
    renderCategoryCards();
    renderGrid();
  } catch (_) {
    syncCatalog();
  }
}

if (supabaseEnabled()) {
  sb.channel("public-catalog-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, applyCatalogChange)
    .subscribe();
}
