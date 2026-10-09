/* =====================================================
   MÉTRICAS DE CHEGADA — lado do visitante
   Avisa o Worker (/api/track) UMA vez por sessão de navegação, sem
   cookie e sem dado pessoal. A origem classificada fica em
   sessionStorage pra js/checkout.js gravar junto do pedido
   (customer.origem) e o painel mostrar vendas por origem.
   Não conta as visitas do próprio dono (sessão do Supabase Auth).
===================================================== */
(function trackVisit() {
  try {
    if (sessionStorage.getItem("recyber_visit_source")) return;

    const ownerLoggedIn = Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k));
    if (ownerLoggedIn) return;

    const params = new URLSearchParams(window.location.search);
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        utm_source: params.get("utm_source") || "",
        utm_campaign: params.get("utm_campaign") || "",
        ref: document.referrer || ""
      })
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data && data.source) sessionStorage.setItem("recyber_visit_source", data.source);
      })
      .catch(() => {});

    sessionStorage.setItem("recyber_visit_source", "pendente");
  } catch (_) { /* navegador sem storage: não conta */ }
})();
