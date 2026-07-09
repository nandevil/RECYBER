/*
  Catálogo de produtos do Re.cyber.
  Para adicionar/editar peças, edite o array PRODUCTS abaixo.
  - image: caminho de uma foto real (ex: "assets/produtos/foto1.jpg").
    Se deixar vazio (""), um placeholder ilustrado é gerado automaticamente.
  - category: "roupas" | "acessorios" | "calcados"
  - condition: estado de conservação (texto livre, ex: "Seminovo", "Ótimo estado")
*/

const PRODUCTS = [
  {
    id: "rc-001",
    name: "Jaqueta Corta-Vento Prisma",
    category: "roupas",
    price: 129.9,
    size: "M",
    condition: "Ótimo estado",
    description: "Jaqueta corta-vento em nylon técnico, gola alta e bolsos frontais. Peça garimpada, poucas marcas de uso.",
    image: "",
    tag: "novo"
  },
  {
    id: "rc-002",
    name: "Calça Cargo Wide Cinza",
    category: "roupas",
    price: 149.0,
    size: "42",
    condition: "Seminovo",
    description: "Calça cargo modelagem wide, seis bolsos, cadarço de ajuste na barra. Tecido resistente, cai muito bem.",
    image: "",
    tag: ""
  },
  {
    id: "rc-003",
    name: "Camiseta Oversized Grafite",
    category: "roupas",
    price: 59.9,
    size: "G",
    condition: "Ótimo estado",
    description: "Camiseta 100% algodão, corte oversized, gola careca reforçada. Estampa discreta nas costas.",
    image: "",
    tag: "promo"
  },
  {
    id: "rc-004",
    name: "Blusa Tricô Trama Aberta",
    category: "roupas",
    price: 89.9,
    size: "P/M",
    condition: "Bom estado",
    description: "Blusa de tricô com trama aberta, caimento solto. Ideal para compor looks em camadas.",
    image: "",
    tag: ""
  },
  {
    id: "rc-005",
    name: "Óculos Retrô Redondo",
    category: "acessorios",
    price: 45.0,
    size: "Único",
    condition: "Ótimo estado",
    description: "Armação redonda estilo retrô, lente escura degradê. Acompanha case simples.",
    image: "",
    tag: "novo"
  },
  {
    id: "rc-006",
    name: "Bolsa Transversal Utilitária",
    category: "acessorios",
    price: 79.9,
    size: "Único",
    condition: "Seminovo",
    description: "Bolsa transversal em nylon resistente, múltiplos compartimentos e fivelas de metal.",
    image: "",
    tag: ""
  },
  {
    id: "rc-007",
    name: "Corrente Prata Old School",
    category: "acessorios",
    price: 39.9,
    size: "60cm",
    condition: "Ótimo estado",
    description: "Corrente banhada, elo grosso, fecho reforçado. Combina com qualquer look underground.",
    image: "",
    tag: "promo"
  },
  {
    id: "rc-008",
    name: "Boné Trucker Patch",
    category: "acessorios",
    price: 49.9,
    size: "Ajustável",
    condition: "Bom estado",
    description: "Boné trucker com tela nas laterais e patch bordado frontal. Ajuste em snapback.",
    image: "",
    tag: ""
  },
  {
    id: "rc-009",
    name: "Tênis Chunky Cinza/Branco",
    category: "calcados",
    price: 189.9,
    size: "39",
    condition: "Seminovo",
    description: "Tênis chunky sola alta, cadarço duplo, entressola em EVA. Solado com desgaste mínimo.",
    image: "",
    tag: "novo"
  },
  {
    id: "rc-010",
    name: "Bota Coturno Preta",
    category: "calcados",
    price: 219.0,
    size: "40",
    condition: "Bom estado",
    description: "Coturno em courino preto, cadarço alto e fivela lateral. Solado tratado, boa aderência.",
    image: "",
    tag: ""
  },
  {
    id: "rc-011",
    name: "Slip-on Xadrez",
    category: "calcados",
    price: 99.9,
    size: "38",
    condition: "Ótimo estado",
    description: "Slip-on estampa xadrez, elástico lateral duplo, muito confortável para o dia a dia.",
    image: "",
    tag: "promo"
  },
  {
    id: "rc-012",
    name: "Sandália Plataforma",
    category: "calcados",
    price: 119.9,
    size: "37",
    condition: "Seminovo",
    description: "Sandália com plataforma de borracha, tiras ajustáveis em velcro. Estilo Y2K.",
    image: "",
    tag: ""
  }
];
