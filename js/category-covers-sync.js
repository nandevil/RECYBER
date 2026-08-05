/* =====================================================
   CAPAS DE CATEGORIA — foto manual escolhida pro card de seleção de
   cada categoria (tabela public.category_covers, Supabase). Tem
   prioridade sobre a foto automática da peça mais antiga (ver
   renderCategoryCards em js/app.js). Sem cover definida pra uma
   categoria, cai pro comportamento automático de sempre.
===================================================== */
let CATEGORY_COVERS = {};

async function fetchCategoryCovers() {
  if (!supabaseEnabled()) return {};
  const { data, error } = await sb.from("category_covers").select("category, image_url");
  if (error) {
    console.warn("Capas de categoria indisponíveis:", error.message);
    return {};
  }
  const map = {};
  data.forEach(row => { map[row.category] = row.image_url; });
  return map;
}

async function syncCategoryCovers() {
  CATEGORY_COVERS = await fetchCategoryCovers();
  if (typeof renderCategoryCards === "function") renderCategoryCards();
}

syncCategoryCovers();
