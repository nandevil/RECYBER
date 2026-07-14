/* =====================================================
   TEXTOS DO MODAL "INFORMAÇÕES" — carrega os textos de Envios,
   Pagamentos e Devolução cadastrados no painel (Supabase) e preenche
   os cards do modal público. Sem Supabase configurado, sem a tabela
   "site_settings" criada, ou com campos vazios, os textos padrão do
   HTML permanecem (modo silencioso).
===================================================== */
async function fetchSiteSettings() {
  if (!supabaseEnabled()) return null;
  const { data, error } = await sb.from("site_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) console.warn("Textos do modal indisponíveis:", error.message);
    return null;
  }
  return rowToSettings(data);
}

async function syncSiteSettings() {
  const settings = await fetchSiteSettings();
  if (!settings) return;
  if (settings.envios) document.getElementById("info-text-envios").textContent = settings.envios;
  if (settings.pagamentos) document.getElementById("info-text-pagamentos").textContent = settings.pagamentos;
  if (settings.devolucao) document.getElementById("info-text-devolucao").textContent = settings.devolucao;
}

syncSiteSettings();
