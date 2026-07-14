/*
  Catálogo de produtos do Re.cyber.

  As peças são cadastradas pelo painel (#admin-dashboard -> aba
  "Cadastro de Peça") e carregadas do Supabase em tempo real
  (js/catalog-sync.js). Este arquivo só define as categorias fixas do
  site — não há mais espaços/placeholders estáticos aqui.

  Categorias fixas (não adicione outras sem também atualizar
  CATEGORY_ICON_PATHS/CATEGORY_BG em app.js):
    camisas, blusas, saias, shorts, calcas,
    casacos-sobreposicoes, bolsas, sapatos
*/

const CATEGORIES = [
  { id: "camisas", label: "Camisas" },
  { id: "blusas", label: "Blusas" },
  { id: "saias", label: "Saias" },
  { id: "shorts", label: "Shorts" },
  { id: "calcas", label: "Calças" },
  { id: "casacos-sobreposicoes", label: "Casacos e Sobreposições" },
  { id: "bolsas", label: "Bolsas" },
  { id: "sapatos", label: "Sapatos" }
];

/* Começa vazio: js/catalog-sync.js preenche com as peças reais do Supabase. */
const PRODUCTS = [];
