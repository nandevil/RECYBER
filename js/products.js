/*
  Catálogo de produtos do Re.cyber.

  Categorias fixas (não adicione outras sem também atualizar
  CATEGORY_ICON_PATHS/CATEGORY_BG em app.js):
    camisas, blusas, saias, shorts, calcas,
    casacos-sobreposicoes, bolsas, sapatos

  Cada categoria já vem com espaços em branco prontos para você
  cadastrar uma peça. Para preencher um espaço, encontre o objeto pelo
  "id" (ex: "camisas-01") no array PRODUCT_OVERRIDES abaixo e preencha:
    - name: nome da peça
    - price: preço em número (ex: 79.9)
    - size: tamanho (ex: "M", "38", "Único")
    - condition: estado de conservação (ex: "Seminovo", "Ótimo estado")
    - description: descrição da peça
    - image: caminho de uma foto real (ex: "img/produtos/camisas-01.jpg").
      Deixe "" para manter o placeholder ilustrado automático.
    - tag: "novo", "promo" ou "" (sem selo)

  Não precisa editar o restante deste arquivo — os espaços vazios são
  gerados automaticamente abaixo.
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

const SLOTS_PER_CATEGORY = 32;

/* Preencha aqui as peças reais — a chave é o id do espaço (ex: "camisas-01"). */
const PRODUCT_OVERRIDES = {
  // "camisas-01": {
  //   name: "Camisa Xadrez Flanela",
  //   price: 89.9,
  //   size: "M",
  //   condition: "Ótimo estado",
  //   description: "Camisa de flanela xadrez, gola clássica, botões originais.",
  //   image: "",
  //   tag: "novo"
  // },
};

function emptySlot(categoryId, slot) {
  return {
    id: `${categoryId}-${String(slot).padStart(2, "0")}`,
    category: categoryId,
    slot,
    name: "",
    price: 0,
    size: "",
    condition: "",
    description: "",
    image: "",
    tag: "",
    empty: true
  };
}

const PRODUCTS = CATEGORIES.flatMap(cat =>
  Array.from({ length: SLOTS_PER_CATEGORY }, (_, i) => {
    const slot = emptySlot(cat.id, i + 1);
    const override = PRODUCT_OVERRIDES[slot.id];
    return override ? { ...slot, ...override, empty: false } : slot;
  })
);
