# Back-end na nuvem com Supabase (gratuito)

O código do site já está pronto para o Supabase. Enquanto você não
seguir estes passos, tudo continua funcionando no **modo local**
(pedidos no navegador de cada cliente). Depois de configurar, os
pedidos passam a ser salvos na nuvem e o painel mostra as vendas de
qualquer dispositivo, com login validado no servidor.

## Passo 1 — Criar a conta e o projeto

1. Acesse <https://supabase.com> e clique em **Start your project**
   (pode entrar com a conta do GitHub `nandevil`).
2. Crie um projeto: nome `recyber`, senha de banco qualquer (guarde),
   região `South America (São Paulo)`.
3. Aguarde ~2 minutos até o projeto ficar pronto.

## Passo 2 — Criar a tabela de pedidos

No menu lateral, abra **SQL Editor**, cole o bloco abaixo e clique
em **Run**:

```sql
create table public.orders (
  id text primary key,
  created_at timestamptz not null default now(),
  items jsonb not null,
  subtotal numeric not null,
  shipping numeric not null,
  total numeric not null,
  customer jsonb not null,
  marketing_opt_in boolean not null default false,
  payment text not null,
  payment_status text not null default 'pendente',
  status text not null default 'recebido'
);

alter table public.orders enable row level security;
alter table public.orders force row level security;

-- Clientes (anônimos) podem apenas CRIAR pedidos
create policy "anon pode inserir pedidos"
  on public.orders for insert to anon with check (true);

-- Apenas usuários logados (você) podem LER, ATUALIZAR e APAGAR
create policy "dono pode ler pedidos"
  on public.orders for select to authenticated using (true);

create policy "dono pode atualizar pedidos"
  on public.orders for update to authenticated using (true) with check (true);

create policy "dono pode deletar pedidos"
  on public.orders for delete to authenticated using (true);
```

> Se você já criou a tabela antes desta política de DELETE existir,
> rode este bloco extra uma vez no SQL Editor para aplicar a correção
> sem perder os dados:
> ```sql
> alter table public.orders force row level security;
> drop policy if exists "dono pode deletar pedidos" on public.orders;
> create policy "dono pode deletar pedidos"
>   on public.orders for delete to authenticated using (true);
> ```

## Passo 3 — Criar o SEU usuário de acesso ao painel

1. Menu **Authentication → Users → Add user → Create new user**.
2. E-mail: `anandalage18@hotmail.com` · senha forte de sua escolha.
3. Marque **Auto Confirm User**.
4. Em **Authentication → Sign In / Up**, desative
   **Allow new users to sign up** (assim ninguém mais cria conta).

## Passo 4 — Conectar o site

1. Menu **Project Settings → API**. Copie:
   - **Project URL** (ex: `https://abcdefgh.supabase.co`)
   - **anon public key** (começa com `eyJ...`)
2. Abra `js/supabase-client.js` e preencha:

```js
const SUPABASE_URL = "https://abcdefgh.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

3. Salve, faça commit e pronto. O painel (`#admin-login`) passa a
   pedir **e-mail e senha** (os do Passo 3) em vez da senha local.

## Passo 5 — Cadastro de peças (catálogo dinâmico)

Permite cadastrar peças no painel (`#admin-dashboard` → aba "Cadastro
de Peça") e elas aparecerem automaticamente no catálogo público,
já dentro do sistema de categorias/filtros que o site já tem.

No **SQL Editor**, cole e rode:

```sql
create table public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  description text,
  price numeric not null default 0,
  category text not null,
  size text,
  condition text,
  image_urls jsonb not null default '[]'::jsonb,
  tag text
);

alter table public.products enable row level security;
alter table public.products force row level security;

-- O catálogo é público: qualquer visitante pode VER as peças
create policy "qualquer um pode ler produtos"
  on public.products for select to anon, authenticated using (true);

-- Só você, logado, pode cadastrar/editar/remover peças
create policy "dono pode inserir produtos"
  on public.products for insert to authenticated with check (true);
create policy "dono pode atualizar produtos"
  on public.products for update to authenticated using (true) with check (true);
create policy "dono pode deletar produtos"
  on public.products for delete to authenticated using (true);
```

Agora crie o bucket de fotos: menu **Storage → New bucket** → nome
`product-images` → marque **Public bucket** → Create bucket. Depois,
volte ao **SQL Editor** e rode:

```sql
create policy "leitura publica das fotos de produtos"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');

create policy "dono pode enviar fotos de produtos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images');

create policy "dono pode atualizar fotos de produtos"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images');

create policy "dono pode apagar fotos de produtos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images');
```

Pronto — sem reiniciar nada, a aba "Cadastro de Peça" do painel já
passa a funcionar (ela detecta sozinha se a tabela existe).

> Se você já criou a tabela `products` com a coluna antiga `image_url`
> (uma foto só), rode este bloco para migrar para várias fotos por
> peça sem perder dados:
> ```sql
> alter table public.products add column if not exists image_urls jsonb not null default '[]'::jsonb;
> update public.products set image_urls = jsonb_build_array(image_url) where image_url is not null and image_urls = '[]'::jsonb;
> alter table public.products drop column if exists image_url;
> ```

## Passo 6 — Feedback de clientes

Permite cadastrar depoimentos no painel (`#admin-dashboard` -> aba
"Feedbacks") e eles aparecerem na home, na seção "Feedback de
Clientes". As fotos usam o **mesmo bucket `product-images`** já
criado no Passo 5 — não precisa criar outro bucket.

No **SQL Editor**, cole e rode:

```sql
create table public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  comment text not null,
  rating int not null default 5,
  photo_url text
);

alter table public.feedbacks enable row level security;
alter table public.feedbacks force row level security;

-- Qualquer visitante pode VER os feedbacks (aparecem na home)
create policy "qualquer um pode ler feedbacks"
  on public.feedbacks for select to anon, authenticated using (true);

-- Só você, logado, pode cadastrar/editar/remover feedbacks
create policy "dono pode inserir feedbacks"
  on public.feedbacks for insert to authenticated with check (true);
create policy "dono pode atualizar feedbacks"
  on public.feedbacks for update to authenticated using (true) with check (true);
create policy "dono pode deletar feedbacks"
  on public.feedbacks for delete to authenticated using (true);
```

Pronto — a aba "Feedbacks" do painel já passa a funcionar, e a seção
"Feedback de Clientes" da home só aparece quando existir pelo menos
um feedback cadastrado (antes disso ela fica escondida).

## Passo 7 — Textos do modal "Informações"

Permite editar, pelo painel (`#admin-dashboard` -> aba "Textos do
Modal"), os textos de Envios/Pagamentos/Devolução que aparecem no
modal "Informações" do site público, sem tocar em código.

No **SQL Editor**, cole e rode:

```sql
create table public.site_settings (
  id int primary key default 1,
  envios_text text not null default '',
  pagamentos_text text not null default '',
  devolucao_text text not null default '',
  updated_at timestamptz not null default now()
);

-- Garante que só existe a linha 1 (configuração única do site)
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

alter table public.site_settings enable row level security;
alter table public.site_settings force row level security;

-- Qualquer visitante pode LER os textos (aparecem no modal público)
create policy "qualquer um pode ler configuracoes"
  on public.site_settings for select to anon, authenticated using (true);

-- Só você, logado, pode ATUALIZAR os textos
create policy "dono pode atualizar configuracoes"
  on public.site_settings for update to authenticated using (true) with check (true);
```

Pronto — a aba "Textos do Modal" já passa a funcionar. Os cartões de
Envios, Pagamentos e Devolução do modal "Informações" carregam esses
textos automaticamente para qualquer visitante.

## Passo 8 — Links de redes sociais (seção "Conecte-se")

Adiciona os links de Instagram/TikTok à mesma tabela `site_settings`
do Passo 7, para editar pelo painel (aba "Textos do Modal") em vez de
ficarem fixos no código. Alimenta tanto a nova seção "Conecte-se" da
home quanto o botão "Redes Sociais" do modal "Informações".

No **SQL Editor**, cole e rode:

```sql
alter table public.site_settings
  add column if not exists instagram_link text not null default '',
  add column if not exists tiktok_link text not null default '',
  add column if not exists tiktok_video_url text not null default '';
```

> A prévia do TikTok (vídeo tocando direto na página) só aparece se
> você preencher "Vídeo em destaque do TikTok" com a URL de um vídeo
> específico — usa o oEmbed oficial e público do TikTok, sem login.
> Não existe API pública para puxar automaticamente "o feed mais
> recente" do Instagram ou TikTok sem um app aprovado pela Meta/TikTok
> (exige revisão e conta comercial) — por isso os cards mostram um
> convite estilizado com o link, não fotos/vídeos "ao vivo".

## Passo 9 — Campanha de desconto (Promoções)

Permite configurar, pelo painel (aba "Promoções"), uma campanha de
desconto global com data de início/fim, e marcar peças individuais
como elegíveis ("Modo Promo"). Enquanto a campanha estiver ativa e
dentro do período, o site público risca o preço original, mostra o
preço com desconto e exibe a categoria dinâmica "Promoções" — que
some sozinha quando a campanha expira ou é desativada.

No **SQL Editor**, cole e rode:

```sql
create table public.promo_settings (
  id int primary key default 1,
  is_active boolean not null default false,
  discount_percent int not null default 10,
  start_date timestamptz,
  end_date timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.promo_settings (id) values (1) on conflict (id) do nothing;

alter table public.promo_settings enable row level security;
alter table public.promo_settings force row level security;

-- Qualquer visitante pode LER a campanha (para calcular o desconto no site)
create policy "qualquer um pode ler campanha"
  on public.promo_settings for select to anon, authenticated using (true);

-- Só você, logado, pode ATUALIZAR a campanha
create policy "dono pode atualizar campanha"
  on public.promo_settings for update to authenticated using (true) with check (true);

-- Marca individual "Modo Promo" em cada peça (reaproveita as políticas
-- de UPDATE já criadas para "products" no Passo 5 — não precisa de nenhuma nova)
alter table public.products add column if not exists is_promo boolean not null default false;
```

> O desconto só é aplicado a uma peça quando **as duas coisas** forem
> verdade: a campanha está `is_active = true` e dentro do período
> (`start_date` ≤ agora ≤ `end_date`) **e** a peça tem "Modo Promo"
> ativado individualmente no painel.

## Passo 10 — Pagamento automático com InfinitePay

Ativa o checkout integrado da InfinitePay (Pix e Cartão numa página
segura hospedada por eles) e a confirmação automática de pagamento:
quando o cliente paga, o pedido muda sozinho de "pendente" para
"pago" no painel, sem você precisar fazer nada manualmente.

Isso passou a exigir um pequeno backend (`worker.js` na raiz do
projeto) rodando dentro do próprio Cloudflare Worker que já hospeda o
site — o deploy continua automático a cada `git push`, nada muda no
seu fluxo.

### 10.1 — Configurar os segredos no Cloudflare

Esses dois valores **nunca** devem ir para o código público (por isso
são "secrets", não variáveis normais). Segundo a documentação oficial
da InfinitePay (docs.infinitepay.io), o Checkout Integrado não exige
nenhuma API key — só a sua InfiniteTag (que já está em `wrangler.toml`,
sem o símbolo `$`). No terminal, dentro da pasta do projeto (precisa
ter o Node.js instalado):

```sh
npx wrangler secret put SUPABASE_URL
# cole quando pedir: https://pzsbmenyseilagvbrnxn.supabase.co

npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# cole a "service_role key" — Project Settings -> API no Supabase.
# ATENÇÃO: essa chave ignora todas as políticas RLS. Só é segura aqui
# porque vive exclusivamente no ambiente do Worker (servidor), nunca
# chega ao navegador do cliente.
```

Se preferir sem terminal: no painel do Cloudflare, abra o Worker
`recyber` → **Settings → Variables and Secrets → Add** → marque como
**Secret** (não "Text") para os dois valores acima.

### 10.2 — Testar antes de divulgar

O `worker.js` já confirma cada pagamento chamando o endpoint oficial
`/payment_check` da InfinitePay antes de marcar o pedido como pago
(evita que alguém finja uma notificação de pagamento aprovado), usando
o formato de resposta documentado (`success`/`paid`). Ainda assim,
antes de divulgar o checkout para clientes de verdade:

1. Faça uma compra de teste (Pix de valor baixo, por exemplo).
2. No painel do Cloudflare, veja os logs do Worker em tempo real:
   `npx wrangler tail` (ou pela aba **Logs** do dashboard).
3. Confirme que o pedido correspondente muda para "pago" no painel
   (`#admin-dashboard` → Monitoramento de Pagamentos).
4. Se não mudar, confira a linha `PAYMENT_CHECK_RESPONSE` nos logs e
   ajuste a condição `confirmed` em `worker.js` para bater
   com a resposta real, faça commit e envie.

## Passo 11 — Fotos das "Atualizações" (bucket "spoilers")

Permite subir a foto spoiler no modal "Administrar Atualizações" do
painel (aba de pedidos → botão "⚙️ Administrar Atualizações"). O e-mail
de aviso em massa não incorpora a imagem diretamente (é montado com um
link `mailto:`, que não suporta anexos/HTML) — a foto entra como um
link clicável no corpo do e-mail.

Crie o bucket: menu **Storage → New bucket** → nome `spoilers` →
marque **Public bucket** → Create bucket. Depois, no **SQL Editor**:

```sql
create policy "leitura publica das fotos de atualizacoes"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'spoilers');

create policy "dono pode enviar fotos de atualizacoes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'spoilers');
```

## Passo 12 — Desconto no carrinho e Frete Grátis

Adiciona a aba "Promoção e Desconto" (antes só "Promoções") duas novas
regras, separadas da campanha por peça do Passo 9:

- **Desconto no carrinho**: valor fixo (R$) ou percentual, liberado
  automaticamente a partir de um valor mínimo gasto, ou exigindo um
  cupom (um código único, não um sistema de vários cupons).
- **Frete grátis**: a partir de um valor mínimo de carrinho.

No **SQL Editor**, cole e rode:

```sql
create table public.cart_discounts (
  id int primary key default 1,
  discount_enabled boolean not null default false,
  discount_type text not null default 'percent', -- 'percent' ou 'fixed'
  discount_value numeric not null default 0,
  discount_min_cart numeric not null default 0,
  discount_requires_coupon boolean not null default false,
  discount_coupon_code text not null default '',
  free_shipping_enabled boolean not null default false,
  free_shipping_min_cart numeric not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.cart_discounts (id) values (1) on conflict (id) do nothing;

alter table public.cart_discounts enable row level security;
alter table public.cart_discounts force row level security;

-- Qualquer visitante pode LER as regras (o carrinho calcula no navegador)
create policy "qualquer um pode ler descontos do carrinho"
  on public.cart_discounts for select to anon, authenticated using (true);

-- Só você, logado, pode ATUALIZAR as regras
create policy "dono pode atualizar descontos do carrinho"
  on public.cart_discounts for update to authenticated using (true) with check (true);
```

> Não cobre "primeira compra" como gatilho — exigiria rastrear
> clientes recorrentes, o que o site não faz hoje (não há login de
> cliente). Os dois modos suportados (automático por valor gasto, ou
> por cupom) cobrem a maior parte do uso real de um cupom de desconto.

## Passo 13 — Remover pedido do painel (arquivamento)

O botão de lixeira no card de pedido (aba "Monitoramento de Pagamento
e de Informações") usa **arquivamento** (soft delete), não apaga o
pedido de verdade — some da tela do painel, mas o registro continua no
banco para não perder histórico de faturamento.

No **SQL Editor**, cole e rode:

```sql
alter table public.orders add column if not exists archived boolean not null default false;
```

Nenhuma política de RLS nova é necessária — a política de UPDATE do
Passo 2 (`dono pode atualizar pedidos`) já cobre a coluna `archived`.

## Passo 14 — E-mail automático de notificação (Resend)

Ativa o envio de verdade (não mais `mailto:`) para os botões
"Notificar Início de Preparação" e "Notificar Envio do Pedido" na aba
de pedidos, e para o cancelamento automático — via `worker.js`, rota
`/api/send-email`.

Pré-requisitos (feitos fora do código, no painel do Resend e da
Cloudflare): domínio `recyber.com.br` verificado no Resend, e uma API
Key gerada com permissão de envio.

No terminal, ou pelo painel do Cloudflare (Worker `recyber` →
**Settings → Variables and Secrets → Add**, tipo **Secret**):

```sh
npx wrangler secret put RESEND_API_KEY
# cole a API Key do Resend (começa com re_...)
```

> O remetente está fixo em `Re.cyber <atendimento@recyber.com.br>` no
> `worker.js` — se preferir outro endereço, precisa ser um e-mail do
> domínio verificado no Resend (não pode ser um Gmail/Hotmail
> qualquer).

## Passo 15 — Editar as mensagens de e-mail pelo painel

Permite configurar assunto, corpo e imagem de cada e-mail de
notificação (Em preparação / Enviado / Cancelado) pela aba "Textos do
Modal" do painel, em vez de ficarem fixos no código. O WhatsApp
continua com o texto fixo — só o e-mail é editável (é o único canal
que suporta imagem).

Reaproveita o bucket `spoilers` já criado no Passo 11 — não precisa
criar um bucket novo. No **SQL Editor**, cole e rode:

```sql
create table public.email_templates (
  id int primary key default 1,
  prep_subject text not null default 'Re.cyber — Seu pedido está em preparação!',
  prep_body text not null default '',
  prep_image_url text not null default '',
  shipped_subject text not null default 'Re.cyber — Seu pedido foi enviado!',
  shipped_body text not null default '',
  shipped_image_url text not null default '',
  cancelled_subject text not null default 'Re.cyber — Pedido cancelado',
  cancelled_body text not null default '',
  cancelled_image_url text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.email_templates (id) values (1) on conflict (id) do nothing;

alter table public.email_templates enable row level security;
alter table public.email_templates force row level security;

-- Diferente de site_settings: aqui NÃO precisa ser público — só o
-- painel (autenticado) lê e escreve, o site público nunca usa isso.
create policy "dono pode ler templates de email"
  on public.email_templates for select to authenticated using (true);

create policy "dono pode atualizar templates de email"
  on public.email_templates for update to authenticated using (true) with check (true);
```

> Se deixar o campo "Corpo do e-mail" em branco no painel, o sistema
> usa o texto criativo padrão automaticamente (definido em
> `js/admin.js`) — não precisa preencher tudo de uma vez.
>
> Use `{{nome}}` e `{{pedido}}` em qualquer lugar do texto — são
> trocados pelo nome do cliente e o código do pedido na hora do envio.

## Segurança — como fica

- A `anon key` é pública por design; a proteção vem das políticas RLS.
- **Pedidos**: visitantes só conseguem **inserir**, nunca ler/apagar
  diretamente do navegador.
- **Produtos**, **feedbacks** e **textos do modal**: são públicos por
  natureza (é uma vitrine), então qualquer visitante pode **ler**; só
  o dono logado pode cadastrar/editar/apagar.
- Ler/atualizar pedidos e cadastrar produtos/feedbacks/textos exigem
  login validado **no servidor** — não é mais contornável pelo
  DevTools.
- Não use a `service_role key` **no código do site** (o que roda no
  navegador do cliente) em hipótese alguma. A única exceção é o
  `worker.js` do Passo 10: ele roda inteiramente no servidor da
  Cloudflare, o navegador do cliente nunca vê essa chave, e é assim
  que o webhook de pagamento consegue marcar o pedido como "pago" sem
  exigir login.
