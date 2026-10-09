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

  const ordersRes = await sb.from("orders").select("created_at, total, payment_status, customer");
  const sales = new Map();
  (ordersRes.data || []).forEach(o => {
    if (o.payment_status !== "pago") return;
    const d = new Date(o.created_at);
    if (metMonthKey(d) !== month) return;
    const origem = o.customer && o.customer.origem;
    if (!origem) return;
    const cur = sales.get(origem) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(o.total) || 0;
    sales.set(origem, cur);
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
        return `<tr><td>${escapeHtml(campaign)}</td><td>${escapeHtml(metLabel(source))}</td><td>${v}</td></tr>`;
      }).join("")
    : `<tr><td colspan="3">Nenhuma visita com link de campanha ainda (use os links prontos abaixo).</td></tr>`;

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
