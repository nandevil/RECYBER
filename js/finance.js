/* =====================================================
   FINANCEIRO (aba "Financeiro" do painel)
   Recebimentos = pedidos com payment_status "pago" (tabela orders,
   incluindo os arquivados — arquivar só some do painel de pedidos).
   Gastos = tabela public.expenses (SUPABASE.md, Passo 35).
   Lucro = recebimentos - gastos. O relatório mensal é recalculado
   toda vez que a aba abre, então sempre reflete os dados atuais.
   Depende de: sb/supabaseEnabled() (supabase-client.js), money(),
   escapeHtml(), showToast() (app.js).
===================================================== */
let finOrders = [];
let finExpenses = [];
let finExpensesAvailable = true;

function finMonthKey(dateLike) {
  const d = new Date(dateLike);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function finDayKey(dateLike) {
  const d = new Date(dateLike);
  return `${finMonthKey(d)}-${String(d.getDate()).padStart(2, "0")}`;
}

function finFormatDate(dateLike) {
  const d = new Date(dateLike);
  return d.toLocaleDateString("pt-BR");
}

function finMonthLabel(key) {
  const [y, m] = key.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(m) - 1]}/${y}`;
}

function finSelectedMonth() {
  return document.getElementById("fin-month").value || finMonthKey(new Date());
}

async function finLoad() {
  if (!supabaseEnabled()) return;

  const ordersRes = await sb.from("orders").select("id, created_at, total, payment_status, customer");
  if (ordersRes.error) {
    console.error("Financeiro — pedidos:", ordersRes.error);
    showToast("Erro ao carregar os pedidos do financeiro");
    finOrders = [];
  } else {
    finOrders = ordersRes.data
      .filter(o => o.payment_status === "pago")
      .map(o => ({
        id: o.id,
        date: o.created_at,
        total: Number(o.total) || 0,
        name: (o.customer && o.customer.nome) || "Cliente"
      }));
  }

  const expRes = await sb.from("expenses").select("*").order("spent_at", { ascending: false });
  if (expRes.error) {
    console.error("Financeiro — gastos:", expRes.error);
    finExpensesAvailable = false;
    finExpenses = [];
  } else {
    finExpensesAvailable = true;
    finExpenses = expRes.data.map(e => ({
      id: e.id,
      date: e.spent_at,
      description: e.description,
      category: e.category,
      amount: Number(e.amount) || 0
    }));
  }
}

function finTotalsByMonth() {
  const map = new Map();
  const bucket = key => {
    if (!map.has(key)) map.set(key, { receipts: 0, expenses: 0 });
    return map.get(key);
  };
  finOrders.forEach(o => { bucket(finMonthKey(o.date)).receipts += o.total; });
  finExpenses.forEach(e => { bucket(e.date.slice(0, 7)).expenses += e.amount; });
  return map;
}

function finProfitClass(value) {
  return value >= 0 ? "fin-positive" : "fin-negative";
}

function finMargin(receipts, profit) {
  return receipts > 0 ? `${((profit / receipts) * 100).toFixed(1).replace(".", ",")}%` : "—";
}

function renderFinance() {
  const month = finSelectedMonth();
  document.getElementById("fin-unavailable").hidden = finExpensesAvailable;
  document.getElementById("fin-form").hidden = !finExpensesAvailable;

  const monthOrders = finOrders.filter(o => finMonthKey(o.date) === month)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const monthExpenses = finExpenses.filter(e => e.date.slice(0, 7) === month);

  const receipts = monthOrders.reduce((s, o) => s + o.total, 0);
  const expenses = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const profit = receipts - expenses;

  document.getElementById("fin-receipts").textContent = money(receipts);
  document.getElementById("fin-expenses").textContent = money(expenses);
  const profitEl = document.getElementById("fin-profit");
  profitEl.textContent = money(profit);
  profitEl.className = `admin-leads-metric-value ${finProfitClass(profit)}`;
  document.getElementById("fin-margin").textContent = finMargin(receipts, profit);

  document.getElementById("fin-expenses-body").innerHTML = monthExpenses.map(e => `
    <tr>
      <td>${escapeHtml(finFormatDate(e.date + "T12:00:00"))}</td>
      <td>${escapeHtml(e.description)}</td>
      <td>${escapeHtml(e.category)}</td>
      <td>${money(e.amount)}</td>
      <td><button class="lead-remove-btn" type="button" data-expense="${escapeHtml(e.id)}">Remover</button></td>
    </tr>`).join("");
  document.getElementById("fin-expenses-empty").hidden = monthExpenses.length !== 0;

  document.getElementById("fin-receipts-body").innerHTML = monthOrders.map(o => `
    <tr>
      <td>${escapeHtml(finFormatDate(o.date))}</td>
      <td>${escapeHtml(o.id)}</td>
      <td>${escapeHtml(o.name)}</td>
      <td>${money(o.total)}</td>
    </tr>`).join("");
  document.getElementById("fin-receipts-empty").hidden = monthOrders.length !== 0;

  const totals = finTotalsByMonth();
  totals.set(month, totals.get(month) || { receipts: 0, expenses: 0 });
  const rows = [...totals.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  document.getElementById("fin-report-body").innerHTML = rows.map(([key, t]) => {
    const p = t.receipts - t.expenses;
    return `
    <tr>
      <td>${escapeHtml(finMonthLabel(key))}</td>
      <td>${money(t.receipts)}</td>
      <td>${money(t.expenses)}</td>
      <td class="${finProfitClass(p)}">${money(p)}</td>
      <td>${finMargin(t.receipts, p)}</td>
    </tr>`;
  }).join("");
}

async function openFinanceTab() {
  const monthInput = document.getElementById("fin-month");
  if (!monthInput.value) monthInput.value = finMonthKey(new Date());
  const dateInput = document.getElementById("fin-date");
  if (!dateInput.value) dateInput.value = finDayKey(new Date());
  await finLoad();
  renderFinance();
}

document.getElementById("admin-tabs").addEventListener("click", e => {
  const pill = e.target.closest("[data-tab]");
  if (pill && pill.dataset.tab === "financeiro") openFinanceTab();
});

document.getElementById("fin-month").addEventListener("change", renderFinance);

document.getElementById("fin-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseEnabled()) return;

  const description = document.getElementById("fin-desc").value.trim();
  const amount = Number(document.getElementById("fin-amount").value);
  const spentAt = document.getElementById("fin-date").value;
  if (!description || !(amount > 0) || !spentAt) return;

  const { error } = await sb.from("expenses").insert({
    spent_at: spentAt,
    description,
    category: document.getElementById("fin-cat").value,
    amount
  });
  if (error) {
    console.error("Financeiro — adicionar gasto:", error);
    showToast(describeSupabaseFormError(error, { table: "expenses", step: "Passo 35" }));
    return;
  }

  document.getElementById("fin-desc").value = "";
  document.getElementById("fin-amount").value = "";
  document.getElementById("fin-month").value = spentAt.slice(0, 7);
  showToast("Gasto adicionado");
  await finLoad();
  renderFinance();
});

document.getElementById("fin-expenses-body").addEventListener("click", async e => {
  const btn = e.target.closest("[data-expense]");
  if (!btn) return;
  if (!confirm("Remover este gasto?")) return;

  const { error } = await sb.from("expenses").delete().eq("id", btn.dataset.expense);
  if (error) {
    console.error("Financeiro — remover gasto:", error);
    showToast("Erro ao remover o gasto");
    return;
  }
  showToast("Gasto removido");
  await finLoad();
  renderFinance();
});

document.getElementById("fin-export-csv").addEventListener("click", () => {
  const totals = [...finTotalsByMonth().entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const lines = ["mes;recebimentos;gastos;lucro"];
  totals.forEach(([key, t]) => {
    const fmt = n => n.toFixed(2).replace(".", ",");
    lines.push([key, fmt(t.receipts), fmt(t.expenses), fmt(t.receipts - t.expenses)].join(";"));
  });
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "relatorio-financeiro-recyber.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});
