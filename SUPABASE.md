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

## Segurança — como fica

- A `anon key` é pública por design; a proteção vem das políticas RLS
  do Passo 2: visitantes só conseguem **inserir** pedidos, nunca ler.
- Ler/atualizar pedidos exige login validado **no servidor** — não é
  mais contornável pelo DevTools.
- Não use a `service_role key` no site em hipótese alguma.
