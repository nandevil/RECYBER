/* =====================================================
   MÉTRICAS DE CHEGADA (aba do painel)
   Visitas: tabela public.visit_counts (contador por dia/origem/
   campanha/aparelho/região, alimentada por /api/track — Passo 36 do
   SUPABASE.md). Vendas por origem: pedidos pagos com customer.origem.
   Depende de: sb/supabaseEnabled(), money(), escapeHtml(), showToast().
===================================================== */
const MET_SOURCE_LABELS = {
  instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", google: "Google",
  bing: "Bing", duckduckgo: "DuckDuckGo", whatsapp: "WhatsApp", youtube: "YouTube",
  pinterest: "Pinterest", twitter: "X / Twitter", email: "E-mail", direto: "Acesso direto",
  outros: "Outros sites"
};

function metLabel(source) {
  return MET_SOURCE_LABELS[source] || source || "—";
}

function metMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function metNextMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function metGroup(rows, keyFn) {
  const map = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    map.set(k, (map.get(k) || 0) + r.visits);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

async function renderMetrics() {
  if (!supabaseEnabled()) return;
  const month = document.getElementById("met-month").value;
  const next = metNextMonthKey(month);

  const visitsRes = await sb.from("visit_counts").select("*")
    .gte("day", `${month}-01`).lt("day", `${next}-01`).limit(5000);
  document.getElementById("met-unavailable").hidden = !visitsRes.error;
  if (visitsRes.error) console.error("Métricas — visitas:", visitsRes.error);
  const rows = (visitsRes.data || []).map(r => ({ ...r, visits: Number(r.visits) || 0 }));

  const ordersRes = await sb.from("orders").select("created_at, total, shipping, payment_status, customer");
  const sales = new Map();
  const campaignSales = new Map();
  (ordersRes.data || []).forEach(o => {
    if (o.payment_status !== "pago") return;
    const d = new Date(o.created_at);
    if (metMonthKey(d) !== month) return;
    const origem = o.customer && o.customer.origem;
    if (!origem) return;
    const cur = sales.get(origem) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Math.max((Number(o.total) || 0) - (Number(o.shipping) || 0), 0);
    sales.set(origem, cur);

    const campanha = o.customer.origemCampanha;
    if (campanha) {
      const ck = `${campanha}|${origem}`;
      campaignSales.set(ck, (campaignSales.get(ck) || 0) + 1);
    }
  });

  const total = rows.reduce((s, r) => s + r.visits, 0);
  const bySource = metGroup(rows, r => r.source);
  document.getElementById("met-total").textContent = total.toLocaleString("pt-BR");
  document.getElementById("met-top").textContent = bySource.length ? metLabel(bySource[0][0]) : "—";
  document.getElementById("met-sales").textContent = [...sales.values()].reduce((s, v) => s + v.count, 0);
  document.getElementById("met-empty").hidden = total !== 0;

  const sourceKeys = new Set([...bySource.map(([k]) => k), ...sales.keys()]);
  const visitsBySource = new Map(bySource);
  document.getElementById("met-sources-body").innerHTML = [...sourceKeys]
    .sort((a, b) => (visitsBySource.get(b) || 0) - (visitsBySource.get(a) || 0))
    .map(k => {
      const v = visitsBySource.get(k) || 0;
      const s = sales.get(k) || { count: 0, total: 0 };
      const pct = total ? `${((v / total) * 100).toFixed(1).replace(".", ",")}%` : "—";
      return `<tr><td>${escapeHtml(metLabel(k))}</td><td>${v}</td><td>${pct}</td><td>${s.count}</td><td>${money(s.total)}</td></tr>`;
    }).join("");

  const campaigns = metGroup(rows.filter(r => r.campaign), r => `${r.campaign}|${r.source}`);
  document.getElementById("met-campaigns-body").innerHTML = campaigns.length
    ? campaigns.map(([k, v]) => {
        const [campaign, source] = k.split("|");
        return `<tr><td>${escapeHtml(campaign)}</td><td>${escapeHtml(metLabel(source))}</td><td>${v}</td><td>${campaignSales.get(k) || 0}</td></tr>`;
      }).join("")
    : `<tr><td colspan="4">Nenhuma visita com link de campanha ainda (use os links com UTM abaixo).</td></tr>`;

  const days = metGroup(rows, r => r.day).sort((a, b) => b[0].localeCompare(a[0]));
  document.getElementById("met-days-body").innerHTML = days
    .map(([d, v]) => `<tr><td>${escapeHtml(d.split("-").reverse().join("/"))}</td><td>${v}</td></tr>`).join("");

  const devices = metGroup(rows, r => r.device).map(([k, v]) => ["Aparelho", k, v]);
  const regions = metGroup(rows.filter(r => r.region), r => r.region).slice(0, 10).map(([k, v]) => ["Região", k, v]);
  document.getElementById("met-extra-body").innerHTML = [...devices, ...regions]
    .map(([t, k, v]) => `<tr><td>${t}</td><td>${escapeHtml(k)}</td><td>${v}</td></tr>`).join("");
}

document.getElementById("admin-tabs").addEventListener("click", e => {
  const pill = e.target.closest("[data-tab]");
  if (!pill || pill.dataset.tab !== "metricas") return;
  const input = document.getElementById("met-month");
  if (!input.value) input.value = metMonthKey(new Date());
  renderMetrics();
});

document.getElementById("met-month").addEventListener("change", renderMetrics);

/* =====================================================
   LINKS COM UTM — um por lugar, campanha editável, botão copiar.
   Posições: bio, stories, post, reel, vídeo, anúncio, e-mail.
   O Worker junta "posição/campanha" (ex.: stories/drop-semana) e a
   venda herda a origem no pedido (customer.origem / origemCampanha).
===================================================== */
const MET_SITE = "https://recyber.com.br/";
const MET_UTM_LINKS = [
  { label: "Instagram — bio",              source: "instagram", medium: "bio",        campaign: "bio" },
  { label: "TikTok — bio",                 source: "tiktok",    medium: "bio",        campaign: "bio" },
  { label: "Instagram — stories",          source: "instagram", medium: "stories",    campaign: "drop-semana" },
  { label: "Instagram — posts",            source: "instagram", medium: "post",       campaign: "drop-semana" },
  { label: "Instagram — Reels",            source: "instagram", medium: "reel",       campaign: "drop-semana" },
  { label: "TikTok — vídeos",              source: "tiktok",    medium: "video",      campaign: "drop-semana" },
  { label: "Instagram — anúncios",         source: "instagram", medium: "ads",        campaign: "promo-novembro" },
  { label: "TikTok — anúncios",            source: "tiktok",    medium: "ads",        campaign: "promo-novembro" },
  { label: "E-mail — aviso de atualização", source: "email",    medium: "newsletter", campaign: "drop-semana" }
];

function metCleanCampaign(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 40);
}

function metBuildUtm(item, campaign) {
  const params = new URLSearchParams({ utm_source: item.source, utm_medium: item.medium });
  const c = metCleanCampaign(campaign);
  if (c) params.set("utm_campaign", c);
  return `${MET_SITE}?${params.toString()}`;
}

async function metCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function renderUtmLinks() {
  const box = document.getElementById("met-utm-list");
  box.innerHTML = MET_UTM_LINKS.map((item, i) => `
    <div class="utm-row" data-i="${i}">
      <span class="utm-label">${escapeHtml(item.label)}</span>
      <label class="utm-campaign"><span>Campanha</span>
        <input type="text" class="utm-campaign-input" maxlength="40" value="${escapeHtml(item.campaign)}"></label>
      <input type="text" class="utm-link" readonly value="${escapeHtml(metBuildUtm(item, item.campaign))}">
      <button type="button" class="pill pill-sm utm-copy">Copiar</button>
    </div>`).join("");
}

document.getElementById("met-utm-list").addEventListener("input", e => {
  const input = e.target.closest(".utm-campaign-input");
  if (!input) return;
  const row = input.closest(".utm-row");
  row.querySelector(".utm-link").value = metBuildUtm(MET_UTM_LINKS[row.dataset.i], input.value);
});

document.getElementById("met-utm-list").addEventListener("click", async e => {
  const btn = e.target.closest(".utm-copy");
  if (!btn) return;
  const link = btn.closest(".utm-row").querySelector(".utm-link").value;
  const ok = await metCopy(link);
  showToast(ok ? "Link copiado" : "Não foi possível copiar — selecione e copie manualmente");
});

renderUtmLinks();
