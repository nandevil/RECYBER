/* =====================================================
   FEEDBACK DE CLIENTES — carrega os depoimentos cadastrados no painel
   (Supabase) e preenche a seção "Feedback de Clientes" da home.
   Sem Supabase configurado, ou sem a tabela "feedbacks" ainda criada,
   ou sem nenhum depoimento cadastrado, a seção inteira fica oculta.
===================================================== */
const AVATAR_ICON = `<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6" fill="currentColor"/><path d="M4.5 20a7.5 7.5 0 0115 0" fill="currentColor"/></svg>`;

async function fetchFeedbacks() {
  if (!supabaseEnabled()) return [];
  const { data, error } = await sb.from("feedbacks").select("*").order("created_at", { ascending: false });
  if (error) {
    console.warn("Feedbacks indisponíveis:", error.message);
    return [];
  }
  return data.map(rowToFeedback);
}

function feedbackCardHtml(f) {
  const stars = "★".repeat(f.rating) + "☆".repeat(5 - f.rating);
  const photoHtml = f.photo ? `<img class="feedback-photo" src="${f.photo}" alt="Foto enviada por ${f.name}" loading="lazy">` : "";
  return `
    <div class="feedback-card">
      <div class="feedback-head">
        <span class="feedback-avatar" aria-hidden="true">${AVATAR_ICON}</span>
        <span class="feedback-name">${f.name}</span>
      </div>
      <p class="feedback-text">${f.comment}</p>
      ${photoHtml}
      <span class="feedback-stars" aria-label="${f.rating} de 5 estrelas">${stars}</span>
    </div>
  `;
}

async function syncFeedbacks() {
  const feedbacks = await fetchFeedbacks();
  const section = document.getElementById("feedback-section");
  if (feedbacks.length === 0) {
    section.hidden = true;
    return;
  }
  document.getElementById("feedback-cards").innerHTML = feedbacks.map(feedbackCardHtml).join("");
  section.hidden = false;
}

syncFeedbacks();
