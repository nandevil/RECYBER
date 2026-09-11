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
Modal" do painel, em vez de ficarem fixos no código. (O texto do
WhatsApp também virou editável — veja o Passo 16 logo abaixo, que
adiciona as colunas que faltam nesta mesma tabela.)

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

## Passo 16 — Editar também o texto do WhatsApp pelo painel

Adiciona 3 colunas na mesma tabela `email_templates` (uma por status)
para o texto do WhatsApp virar editável na aba "Texto WhatsApp e
E-mail", junto com o e-mail. Se já rodou o Passo 15, só rode isto (não
precisa recriar a tabela). No **SQL Editor**, cole e rode:

```sql
alter table public.email_templates
  add column if not exists prep_whatsapp text not null default $$Alerta de Garimpo: seu pedido já entrou no nosso laboratório de regeneração! 🧪✨

Olá, {{nome}}! Nossos circuitos detectaram sua escolha sustentável (pedido {{pedido}}) e já estamos separando, higienizando e embalando suas peças com todo o carinho que o planeta merece. Assim que for enviado, você recebe o código de rastreio por aqui. Em breve ela ganha uma nova história com você! 💚$$,
  add column if not exists shipped_whatsapp text not null default $$Caixinha Re.cyber liberada para o espaço! 🛸📦

Boas notícias, {{nome}}! Seu garimpo (pedido {{pedido}}) foi oficialmente postado e está a caminho da sua casa. O código de rastreamento chega em seguida por aqui para você acompanhar a viagem das suas novas peças. Prepare o guarda-roupa! ✨$$,
  add column if not exists cancelled_whatsapp text not null default $$Olá {{nome}}! Seu pedido {{pedido}} no Re.cyber foi cancelado. Se já tiver feito o pagamento ou tiver alguma dúvida, é só responder por aqui que a gente resolve. 🙏$$;
```

> Mesma regra do e-mail: deixar em branco no painel usa o texto
> criativo padrão automaticamente. `{{nome}}` e `{{pedido}}` funcionam
> igual no WhatsApp.

## Passo 17 — Aviso de "Modo Promo" (botões da aba "Promoções")

Adiciona um 4º conjunto de colunas na tabela `email_templates` — igual
aos Passos 15/16, mas para o aviso disparado pelos botões "⚡ Ativar
Modo Promo" e "📣 Disparar aviso de modo promo". Também editável na
aba "Textos do Modal" (bloco "Aviso de Promoção"). No **SQL Editor**,
cole e rode:

```sql
alter table public.email_templates
  add column if not exists promo_whatsapp text not null default $$Modo Promo ativado no Re.cyber! ⚡🟢

Olá, {{nome}}! Nosso brechó entrou em modo promocional: peças selecionadas com desconto por tempo limitado. Corre porque cada peça é única e não volta! 💚$$,
  add column if not exists promo_subject text not null default 'Re.cyber — Modo Promo ativado! ⚡',
  add column if not exists promo_body text not null default $$Modo Promo ativado no Re.cyber! ⚡🟢

Olá, {{nome}}! Nosso brechó entrou em modo promocional: peças selecionadas com desconto por tempo limitado. Corre porque cada peça é única e não volta! 💚$$,
  add column if not exists promo_image_url text not null default '';
```

> O botão "⚡ Ativar Modo Promo" só liga a campanha (`promo_settings`,
> Passo 9) — não dispara aviso nenhum sozinho. Quem dispara é o botão
> separado "📣 Disparar aviso de modo promo": o e-mail vai automático
> (via Resend) para todo cliente inscrito (`marketing_opt_in`); o
> WhatsApp abre um link `wa.me` pronto por contato — você clica em
> "Enviar" um a um, porque não existe envio automático em massa sem a
> API paga do WhatsApp Business.

## Passo 18 — Newsletter (captura de e-mail na home)

Cria a tabela que recebe as inscrições da seção "Fique por dentro do
Re.cyber", logo acima do rodapé. Qualquer visitante pode se inscrever
(`insert`), mas só o dono logado consegue ler a lista (`select`) — o
mesmo padrão de segurança do restante do site. No **SQL Editor**, cole
e rode:

```sql
create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  active boolean not null default true
);

alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_subscribers force row level security;

create policy "qualquer um pode se inscrever"
  on public.newsletter_subscribers for insert to anon, authenticated with check (true);

create policy "só o dono lê a lista"
  on public.newsletter_subscribers for select to authenticated using (true);
```

> Sem essa tabela, o formulário mostra "Não foi possível concluir a
> inscrição" ao tentar se inscrever — o site continua funcionando
> normalmente no resto, só essa seção fica indisponível.
>
> Pra usar essa lista num disparo futuro (ex: reaproveitando o botão
> "Disparar aviso de modo promo" ou "Administrar Atualizações"), basta
> ler `email` onde `active = true`. O link de descadastro público (pra
> incluir no rodapé dos e-mails de marketing) é uma etapa separada,
> ainda não construída — veja o Passo 19 abaixo pra habilitar só o
> "Remover" do painel por enquanto.

## Passo 19 — Permitir remover inscrito da newsletter pelo painel

O botão "Remover" na aba "Controle de Marketing" desativa o inscrito
(`active = false`) em vez de apagar a linha — assim ele não aparece
mais nos disparos, mas o histórico fica guardado. Isso exige uma
política de **update**, que o Passo 18 ainda não tinha criado. No
**SQL Editor**, cole e rode:

```sql
create policy "dono pode atualizar inscritos"
  on public.newsletter_subscribers for update to authenticated using (true) with check (true);
```

> Isso só permite update pra quem está logado no painel (o dono) —
> visitantes continuam só conseguindo inserir a própria inscrição.

## Passo 20 — Configurações de Envio (Etiqueta)

Guarda a altura, largura, comprimento e peso padrão de **uma peça**
(aba "Promoção e Desconto" → "Configurações de Envio"). Não muda o
frete cobrado do cliente — isso continua fixo (R$18/R$10, calculado
em `js/checkout.js`). Serve pra alimentar uma etapa futura: gerar a
etiqueta de envio automaticamente (Melhor Envio) multiplicando essas
medidas pela quantidade de peças da compra. Só o dono logado lê/edita
— não é usado em nenhuma tela pública. No **SQL Editor**, cole e rode:

```sql
create table public.shipping_settings (
  id int primary key default 1,
  height_cm numeric not null default 15,
  width_cm numeric not null default 15,
  length_cm numeric not null default 15,
  weight_kg numeric not null default 0.5,
  updated_at timestamptz not null default now()
);

insert into public.shipping_settings (id) values (1) on conflict (id) do nothing;

alter table public.shipping_settings enable row level security;
alter table public.shipping_settings force row level security;

create policy "dono pode ler configurações de envio"
  on public.shipping_settings for select to authenticated using (true);

create policy "dono pode atualizar configurações de envio"
  on public.shipping_settings for update to authenticated using (true) with check (true);
```

## Passo 21 — Conexão OAuth com o Melhor Envio

Guarda o `access_token`/`refresh_token` da integração com o Melhor
Envio (usados pra gerar etiqueta automaticamente depois que a compra
é aprovada — etapa futura). **Diferente de tudo até aqui, essa tabela
não tem NENHUMA política de RLS pra `anon` nem `authenticated`** — só
o `worker.js`, usando a `service_role key`, consegue ler/escrever
(o painel nunca lê o token direto, só chama `/api/melhorenvio/status`
pra saber se está conectado). No **SQL Editor**, cole e rode:

```sql
create table public.melhorenvio_tokens (
  id int primary key default 1,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  pending_state text,
  updated_at timestamptz not null default now()
);

insert into public.melhorenvio_tokens (id) values (1) on conflict (id) do nothing;

alter table public.melhorenvio_tokens enable row level security;
alter table public.melhorenvio_tokens force row level security;

-- Sem nenhuma "create policy" de propósito: só a service_role key
-- (que ignora RLS por padrão no Supabase) consegue tocar essa tabela.
```

Depois de rodar isso, configure os secrets do Worker (veja
`wrangler.toml`) e clique em "Conectar Melhor Envio" no painel, aba
"Promoção e Desconto":
- `MELHORENVIO_CLIENT_ID` (texto simples, não é segredo de verdade)
- `MELHORENVIO_CLIENT_SECRET` (secret — nunca cole em texto puro em
  lugar nenhum, nem aqui)

> O app foi criado no Melhor Envio sem confirmação se era ambiente de
> Sandbox ou Produção. `wrangler.toml` está configurado com
> `MELHORENVIO_BASE_URL = "https://sandbox.melhorenvio.com.br"` por
> padrão — se o botão "Conectar" der erro de autenticação, o app
> provavelmente foi criado em produção; troque essa variável pra
> `https://melhorenvio.com.br` e publique de novo.

## Passo 22 — Serviço padrão de envio (geração automática de etiqueta)

Adiciona a coluna que falta pra `shipping_settings` guardar qual
serviço (transportadora + modalidade, ex: Correios PAC) usar por
padrão ao inserir a etiqueta no carrinho do Melhor Envio, assim que um
pagamento é aprovado. Sem essa coluna preenchida, a etiqueta
simplesmente não é gerada (fica só um aviso no log do Worker) — o
pedido continua sendo marcado como "pago" normalmente. No **SQL
Editor**, cole e rode:

```sql
alter table public.shipping_settings
  add column if not exists melhorenvio_service_id int;
```

> O ID do serviço você encontra no painel do Melhor Envio (em
> Configurações → Serviços, ou parecido — cada transportadora
> habilitada na sua conta tem um número ao lado). Preencha esse número
> na aba "Configurações de Envio" do painel.
>
> O endereço de remetente (nome, telefone, CPF, endereço da loja)
> ficou fixo direto no `worker.js` (constante `MELHORENVIO_SENDER`),
> a pedido do dono da loja — se mudar de endereço no futuro, precisa
> editar o código, não tem tela no painel pra isso ainda.

## Passo 23 — Painel atualiza sozinho quando o pagamento é confirmado

Liga o Realtime do Supabase na tabela `orders` — sem isso, o painel só
mostra o pedido como "Pagamento Concluído" depois que você atualizar a
página (F5) manualmente. No **SQL Editor**, cole e rode:

```sql
alter publication supabase_realtime add table public.orders;
```

> Se der erro "relation is already member of publication", já estava
> habilitado — pode ignorar. Isso não muda nenhuma permissão (RLS
> continua valendo do mesmo jeito pra Realtime); só liga o aviso
> automático de mudança pra quem já tem acesso de leitura.

## Passo 24 — "Peça esgotada" (marca peça como vendida)

Adiciona a coluna que guarda se uma peça já foi vendida. Quando
marcada, o site público mostra "ESGOTADO" por cima da foto e desativa
o botão de comprar — sem apagar a peça do catálogo (fica registrada,
só não compra mais). No **SQL Editor**, cole e rode:

```sql
alter table public.products
  add column if not exists is_sold boolean not null default false;
```

> Isso é marcado de dois jeitos: **automaticamente** (o Worker marca
> sozinho assim que o pagamento de um pedido com aquela peça é
> confirmado) e **manualmente** (um interruptor "Vendido" na lista de
> peças cadastradas, aba "Cadastro de Peça" — útil pra vendas fora do
> site, tipo Instagram ou pessoalmente).

## Passo 25 — Cadastro de peça automatizado (fora do painel)

Permite cadastrar peças sem abrir o painel/fazer login — usado quando
você manda fotos + descrição direto na conversa e pede pra cadastrar
automaticamente. **Não é a sua senha do painel**: é um token separado,
só pra essa função específica, que você mesmo gera e guarda como
Secret no Cloudflare (mesmo padrão do `RESEND_API_KEY`,
`MELHORENVIO_CLIENT_SECRET` etc — nunca fica no código).

1. No painel do Cloudflare: Workers & Pages → **recyber** → Settings
   → Variables and Secrets → **+ Add**.
2. Type: **Secret**. Name: `ADMIN_API_TOKEN`. Valor: qualquer texto
   longo e aleatório (o token gerado pra essa conversa foi
   `Rx5qK9Xyj79EoilxxPeVQVAxlKOKZLqhPqKMylKi1+A=` — pode usar esse ou
   gerar outro).
3. Salve/publique.

> Esse token dá acesso só a **cadastrar peças** (rota
> `/api/admin/add-product`) — não abre porta pra pedidos, pagamentos
> nem qualquer outra parte do sistema. Ainda assim, trate como senha:
> se desconfiar que vazou, troque o valor no Cloudflare (revoga o
> antigo na hora).
>
> Fluxo de uso: salve as fotos da peça em `img/inbox/` (dentro da
> pasta do projeto, sincronizada pelo OneDrive — dá pra jogar foto lá
> direto do celular) e peça pra cadastrar; a automação lê os arquivos
> dali, sobe pro Storage e insere a peça, sem precisar colar imagem no
> chat nem abrir o painel.

## Passo 26 — Feed de produtos (catálogo pro Instagram Shopping / TikTok)

Rota pública `https://recyber.com.br/feed.xml` — gera automaticamente
um feed no formato RSS/Google Shopping (o mesmo que o Meta Commerce
Manager aceita) a partir das peças cadastradas no Supabase. Não exige
nenhum Secret novo, já funciona com o `SUPABASE_URL` que o worker já
usa. Cada peça vira um `<item>` com id, título, descrição, link, foto,
preço, disponibilidade ("in stock"/"out of stock" conforme "peça
esgotada") e condição ("used", já que é brechó).

O link de cada item é `https://recyber.com.br/?produto=ID` — abre
direto na peça certa (js/catalog-sync.js lê esse parâmetro na URL e
chama o modal de visualização automaticamente).

**Pra conectar no Instagram Shopping** (Meta Commerce Manager):
1. Tenha uma conta comercial no Instagram vinculada a uma Página do
   Facebook, e o domínio `recyber.com.br` verificado no Meta Business
   Suite (Configurações → Contas de marca → Domínios).
2. Business Suite → **Commerce Manager** → Criar catálogo → tipo
   "E-commerce" → adicionar itens → **Feed de dados** → cole a URL
   `https://recyber.com.br/feed.xml` → defina atualização automática
   (diária, por exemplo).
3. Depois de o catálogo ser aprovado, vincule-o à conta do Instagram
   (Configurações da conta → Compras) e ative o Instagram Shopping.
4. No Brasil a Meta não processa pagamento dentro do app — quem clicar
   num produto é levado pro `recyber.com.br` pra finalizar a compra,
   exatamente como o site já funciona hoje.

**TikTok Shop** não usa esse feed — é um canal de venda dentro do
próprio app, com cadastro de vendedor separado (CNPJ ou MEI, conta
bancária PJ, endereço de armazém/devolução) feito direto no **Seller
Center** do TikTok Shop. Isso não dá pra automatizar por aqui; quando
tiver a conta aprovada, um novo endpoint de feed pode ser adaptado pro
formato deles se for preciso.

> **Variante em CSV**: `https://recyber.com.br/feed-produtos.csv` gera
> o mesmo catálogo em CSV (colunas `id,title,description,availability,
> condition,price,link,image_link,brand,google_product_category`), com
> uma diferença de propósito: todo `link` aponta pra
> `https://recyber.com.br/` (home), não pra peça específica — use essa
> versão se quiser que todo clique no anúncio/loja leve pro site geral
> em vez de abrir a peça direto. Cole essa URL em Gerenciador de
> Comércio → Fontes de dados → "Usar um URL".

## Passo 27 — Capa manual das categorias

Permite escolher uma foto fixa pro card de cada categoria (tela
"Categorias" da home), em vez de sempre usar a foto da peça mais
antiga cadastrada ali. Sem cover definida, continua caindo pro
comportamento automático de sempre.

No **SQL Editor**, cole e rode:

```sql
create table public.category_covers (
  category text primary key,
  image_url text not null,
  updated_at timestamptz not null default now()
);

alter table public.category_covers enable row level security;
alter table public.category_covers force row level security;

create policy "qualquer um pode ler capas de categoria"
  on public.category_covers for select to anon, authenticated using (true);

create policy "dono pode gerenciar capas de categoria"
  on public.category_covers for all to authenticated using (true) with check (true);
```

As fotos usam o mesmo bucket `product-images` do Passo 5 — não precisa
criar bucket novo nem policy de Storage nova.

Pra definir a capa de uma categoria sem abrir o painel, usa a mesma
automação do Passo 25 (token `ADMIN_API_TOKEN`), na rota
`POST /api/admin/set-category-cover` com corpo:
```json
{ "category": "vestidos", "image": { "filename": "capa.jpg", "contentType": "image/jpeg", "base64": "..." } }
```

## Passo 28 — Catálogo atualiza sozinho quando uma peça é vendida

Liga o Realtime do Supabase na tabela `products` — sem isso, quem já
está com o site aberto só vê uma peça como "Esgotado" depois de dar F5
manualmente (o pagamento confirmado marca a peça no banco na hora, mas
a tela de quem já estava navegando não sabia que precisava atualizar).
No **SQL Editor**, cole e rode:

```sql
alter publication supabase_realtime add table public.products;
```

> Mesmo aviso do Passo 23: se der erro "relation is already member of
> publication", já estava habilitado — pode ignorar. Não muda nenhuma
> permissão (RLS continua valendo); só liga o aviso automático de
> mudança pra quem já tem acesso de leitura (que é todo mundo, já que
> o catálogo é público).

## Passo 29 — Diagnóstico do webhook de pagamento (InfinitePay)

Se o status do pedido nunca muda sozinho pra "Pagamento Concluído"
(precisando sempre confirmar manualmente no painel), o próximo passo é
enxergar o que a InfinitePay está realmente respondendo quando o
webhook é chamado — sem isso é impossível saber se o problema é o
webhook não chegar, a confirmação da transação falhar, ou outra coisa.
Essa tabela guarda as últimas tentativas pra investigar.

No **SQL Editor**, cole e rode:

```sql
create table public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  payload jsonb,
  response jsonb,
  confirmed boolean,
  note text
);

alter table public.webhook_logs enable row level security;
alter table public.webhook_logs force row level security;
-- Sem nenhuma policy: só a service_role key (usada só dentro do
-- Worker) consegue ler/escrever. Nem o dono logado nem visitantes têm
-- acesso — é só um log técnico temporário pra diagnóstico.
```

Depois de rodar isso, peça pra eu consultar `/api/admin/webhook-logs`
(mesmo token `ADMIN_API_TOKEN`) depois de um pagamento de teste — aí
dá pra ver exatamente o que a InfinitePay respondeu e corrigir o
código com precisão, em vez de tentar adivinhar.

## Passo 30 — Trava o formato do id do pedido (reforço contra XSS)

O `id` do pedido é criado pelo próprio navegador do cliente
(`RC-<timestamp>`) e a política de inserção anônima aceita qualquer
texto (`with check (true)`) — nada impede, em teoria, que alguém monte
uma chamada direta pra API do Supabase (sem passar pelo site) com um
`id` ou outros campos contendo HTML/script. O painel já escapa esse
conteúdo antes de exibir (proteção principal), mas travar o formato
aceito no próprio banco é uma segunda camada de defesa — impede que
esse tipo de valor sequer seja gravado. No **SQL Editor**, cole e rode:

```sql
drop policy if exists "anon pode inserir pedidos" on public.orders;
create policy "anon pode inserir pedidos"
  on public.orders for insert to anon
  with check (id ~ '^RC-[0-9]+$');
```

> Só recria a política de inserção com uma validação a mais — não
> afeta pedidos que já existem, só passa a exigir esse formato pra
> pedidos novos. Se algum dia o site mudar como gera o id do pedido,
> essa expressão (`^RC-[0-9]+$`) precisa ser atualizada junto.

## ⚠️ Ação crítica — desativar cadastro público no Supabase Auth

**Isso não dá pra corrigir por código — precisa ser feito manualmente
no painel do Supabase, o quanto antes.** Testei (sem criar nenhuma
conta de verdade) e confirmei que o projeto aceita **qualquer pessoa
se cadastrar** direto na API de autenticação do Supabase — mesmo o
site só tendo tela de login, não de cadastro, isso não bloqueia
chamadas diretas à API.

O problema: todas as regras de segurança do banco (RLS) — pedidos,
produtos, configurações, lista de e-mails da newsletter — liberam
acesso de escrita/leitura pra **qualquer usuário autenticado**,
presumindo que só existe uma conta (a sua). Com cadastro público
ligado, qualquer pessoa pode criar uma conta e, a partir dela, **ler
todos os pedidos (nome, CPF, endereço, telefone de clientes),
editar/apagar produtos, mexer nas configurações do site e ver a lista
de e-mails da newsletter** — sem precisar da sua senha.

**Como corrigir agora:**
1. [supabase.com/dashboard](https://supabase.com/dashboard) → seu projeto
2. **Authentication** (menu lateral) → **Sign In / Providers** (ou
   **Settings** → **Auth**, dependendo da versão do painel)
3. Localize a opção **"Allow new users to sign up"** (ou "Enable
   sign ups") e **desative**
4. Salve

Isso não afeta seu login — sua conta já existe e continua funcionando
normalmente. Só impede que gente nova se cadastre sozinha.

## Passo 31 — Vários tamanhos por peça (com medidas)

Permite cadastrar uma peça com mais de um tamanho disponível, cada um
com suas próprias medidas (ex: "M — largura 20cm, comprimento 50cm" e
"G — largura 50cm, comprimento 80cm"). No **SQL Editor**, cole e rode:

```sql
alter table public.products add column if not exists sizes jsonb not null default '[]'::jsonb;
```

> Não quebra peças já cadastradas — elas continuam com o campo antigo
> `size` (texto simples) até você editá-las e preencher os tamanhos
> novos pelo painel. O campo `size` continua existindo e é preenchido
> automaticamente (lista dos tamanhos separada por vírgula) só pra
> compatibilidade com qualquer parte do sistema que ainda leia o
> formato antigo.

## Passo 32 — Gênero da peça (feminino/masculino/unissex)

Necessário pra exportar o catálogo pro TikTok Shop corretamente — a
árvore de categorias deles é separada por gênero, e categorizar uma
peça masculina como feminina (ou vice-versa) pode gerar advertência da
própria plataforma. No **SQL Editor**, cole e rode:

```sql
alter table public.products add column if not exists gender text not null default 'unissex';
```

> Peças já cadastradas ficam como "unissex" até você editá-las e
> escolher o gênero certo pelo painel. Isso não afeta nada no catálogo
> público do site — o campo só existe pra alimentar exportações como a
> do TikTok Shop.

## Passo 33 — Exportar catálogo pro TikTok Shop (carga em massa)

Rota pública `https://recyber.com.br/tiktok-feed.csv` — gera as linhas
de dados no formato exato do modelo de carga em massa do TikTok Shop
Seller Center (32 colunas, uma linha por tamanho/variação de cada
peça), extraído do arquivo baixado em Gerenciar produtos → Adicionar
produto → Carregar em massa → Baixar modelo (categoria "Vestidos").

**Cobertura atual — roupas feminina e masculina**: entram no arquivo
peças com **gênero = Feminino ou Masculino** (Passo 32) nas categorias
Vestidos (só feminino), Blusas, Camisas, Saias (só feminino), Shorts,
Bermudas, Calças e Casacos e Sobreposições. Bolsas, Sapatos e peças
"Unissex" ficam de fora por enquanto — o TikTok usa uma árvore de
categoria e um modelo de planilha próprio pra Bolsas/Sapatos, que
ainda não baixamos (mesmo processo do Passo 1 no Seller Center,
categoria diferente).

**Como usar (o mesmo arquivo `tiktok-feed.csv` já traz as duas árvores
juntas — é só separar as linhas por categoria na hora de colar):**
1. Abra `https://recyber.com.br/tiktok-feed.csv` no navegador (baixa
   ou abre como planilha, dependendo do programa padrão)
2. Abra o arquivo modelo `.xlsx` correspondente ao gênero (o baixado
   com categoria "Vestidos" pras linhas femininas, o de "Camisas" pras
   masculinas — são modelos diferentes, cada um só aceita as
   categorias da própria árvore)
3. Cole as linhas do CSV daquele gênero a partir da **linha 7** do
   modelo (as 6 primeiras linhas são cabeçalho/instrução do próprio
   TikTok — não mexa nelas)
4. Salve o `.xlsx` e suba em Gerenciar produtos → Carregar em massa
   (um upload pra cada gênero, já que são modelos separados)

> Não geramos o `.xlsx` pronto porque o modelo do TikTok tem validações
> internas (listas suspensas, formatação condicional) que são
> arriscadas de recriar do zero — colar os dados no arquivo original
> deles preserva tudo isso.

## Passo 34 — Fotos migradas pro Cloudflare R2 (fora do Supabase)

O Supabase Storage cobra/bloqueia por **tráfego** (egress) — o plano
gratuito tem só 5GB/mês, e como as fotos das peças são recarregadas a
cada visita ao site, isso estourou rápido e derrubou o projeto inteiro
(erro 402 "exceed_cached_egress_quota", banco E fotos bloqueados até o
ciclo renovar ou o plano ser pago).

A partir daqui, **as fotos não ficam mais no Supabase** — ficam num
bucket **Cloudflare R2** (`recyber-images`), que tem os mesmos 10GB de
armazenamento grátis, mas **egress sempre gratuito, sem limite**. O
banco de dados (pedidos, produtos, textos) continua no Supabase
normalmente — só o peso pesado (fotos) saiu de lá.

### Configuração (já feita, documentando pra referência futura)

1. No painel do Cloudflare → **R2 Object Storage** → ativar o R2 na
   conta (gratuito dentro do limite, só pede forma de pagamento
   cadastrada como garantia de excedente)
2. Criar bucket: nome `recyber-images`, Location "Automatic", Storage
   Class "Standard"
3. No bucket → **Settings** → **Public Development URL** → Enable —
   gera uma URL tipo `https://pub-xxxxxxxxxxxx.r2.dev`
4. No `wrangler.toml`, adicionar o binding do bucket e a URL pública:
   ```toml
   [[r2_buckets]]
   binding = "IMAGES"
   bucket_name = "recyber-images"

   [vars]
   R2_PUBLIC_URL = "https://pub-xxxxxxxxxxxx.r2.dev"
   ```

### Como funciona no código

- **Peça/feedback/etc. cadastrados pelo painel**: o navegador não sobe
  mais a foto direto pro Storage — manda pro Worker
  (`POST /api/admin/upload-image`, exige sessão do dono logado), que
  sobe pro R2 e devolve a URL pública.
- **Automação sem login** (`/api/admin/add-product`,
  `/api/admin/set-category-cover`, protegidas por `ADMIN_API_TOKEN`):
  já sobem a foto direto pro R2 também, usando a mesma função
  `uploadImageToR2()`.
- **Fotos já publicadas antes dessa mudança** continuam funcionando
  (as URLs antigas do Supabase Storage não somem), mas pra elas
  pararem de consumir tráfego do Supabase é preciso migrar — use o
  botão **"Migrar fotos pro novo armazenamento (R2)"** na aba Cadastro
  de Peça do painel. Pode rodar quantas vezes quiser: ele pula
  automaticamente as fotos que já estão no R2, então só processa o que
  ainda falta a cada rodada.

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
