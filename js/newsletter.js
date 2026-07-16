/* =====================================================
   NEWSLETTER — captura de e-mail pública (tabela newsletter_subscribers
   no Supabase, SUPABASE.md Passo 18). Sem Supabase configurado, o
   formulário avisa que a inscrição está indisponível no momento.
===================================================== */
function isValidNewsletterEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showNewsletterMessage(text, type) {
  const el = document.getElementById("newsletter-message");
  el.hidden = false;
  el.textContent = text;
  el.className = `newsletter-message ${type}`;
}

document.getElementById("newsletter-form").addEventListener("submit", async e => {
  e.preventDefault();
  const input = document.getElementById("newsletter-email");
  const submitBtn = document.getElementById("newsletter-submit");
  const email = input.value.trim();

  if (!isValidNewsletterEmail(email)) {
    showNewsletterMessage("Digite um e-mail válido.", "error");
    return;
  }
  if (!supabaseEnabled()) {
    showNewsletterMessage("Inscrição indisponível no momento. Tente novamente mais tarde.", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando...";
  const { error } = await sb.from("newsletter_subscribers").insert({ email });
  submitBtn.disabled = false;
  submitBtn.textContent = "Fazer Parte";

  if (error) {
    if (error.code === "23505") {
      showNewsletterMessage("Este e-mail já está inscrito em nossa lista!", "error");
    } else {
      console.error("Newsletter:", error);
      showNewsletterMessage("Não foi possível concluir a inscrição. Tente novamente.", "error");
    }
    return;
  }

  input.value = "";
  showNewsletterMessage("Pronto! Você foi adicionado à nossa lista de atualizações.", "success");
});
