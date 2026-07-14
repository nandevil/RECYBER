/* =====================================================
   CONFIGURAÇÕES DO SITE — carrega da tabela public.site_settings
   (Supabase): textos do modal "Informações" (Envios/Pagamentos/
   Devolução), links de Instagram/TikTok e a prévia de vídeo do
   TikTok. Alimenta tanto a seção "Conecte-se" da home quanto o card
   "Redes Sociais" do modal Informações. Sem Supabase configurado, sem
   a tabela criada, ou com campos vazios, os valores padrão do HTML/
   CONFIG (js/app.js) permanecem (modo silencioso).
===================================================== */
let siteSettingsCache = null;

/* Extrai "@usuario" de uma URL de perfil (instagram.com/x, tiktok.com/@x). */
function extractHandle(url) {
  if (!url) return "";
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    const first = (path.split("/")[0] || "").trim();
    if (!first) return "";
    return first.startsWith("@") ? first : `@${first}`;
  } catch {
    return "";
  }
}

async function fetchSiteSettings() {
  if (!supabaseEnabled()) return null;
  const { data, error } = await sb.from("site_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) console.warn("Configurações do site indisponíveis:", error.message);
    return null;
  }
  return rowToSettings(data);
}

/* Prévia pública do TikTok via oEmbed oficial (sem login) — só roda
   quando um vídeo específico é configurado no painel. */
async function loadTiktokEmbed(videoUrl) {
  const wrap = document.getElementById("social-tiktok-embed");
  if (!wrap) return;
  if (!videoUrl) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`);
    if (!res.ok) throw new Error(`oEmbed retornou ${res.status}`);
    const data = await res.json();
    wrap.innerHTML = data.html;
    wrap.hidden = false;
  } catch (err) {
    console.warn("Prévia do TikTok indisponível:", err.message);
    wrap.hidden = true;
  }
}

async function syncSiteSettings() {
  const settings = await fetchSiteSettings();
  if (!settings) return;
  siteSettingsCache = settings;

  if (settings.envios) document.getElementById("info-text-envios").textContent = settings.envios;
  if (settings.pagamentos) document.getElementById("info-text-pagamentos").textContent = settings.pagamentos;
  if (settings.devolucao) document.getElementById("info-text-devolucao").textContent = settings.devolucao;

  if (settings.instagram) {
    document.getElementById("social-instagram-link").href = settings.instagram;
    document.getElementById("social-instagram-handle").textContent = extractHandle(settings.instagram) || "Instagram";
  }
  if (settings.tiktok) {
    document.getElementById("social-tiktok-link").href = settings.tiktok;
    document.getElementById("social-tiktok-handle").textContent = extractHandle(settings.tiktok) || "TikTok";
  }
  if (settings.tiktokVideoUrl) loadTiktokEmbed(settings.tiktokVideoUrl);
}

syncSiteSettings();
