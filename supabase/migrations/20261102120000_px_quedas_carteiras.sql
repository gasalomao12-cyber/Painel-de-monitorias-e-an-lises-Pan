-- PX Monitorias & Feedbacks — carteiras na força-tarefa de queda de ligação (ex.: SAFRA).
-- px_profiles.portfolio: carteira do usuário (vazio = PAN).
-- px_roster: cada usuário guarda o próprio capacity (scope = id do usuário); o capacity anterior a esta
--            migração fica em scope 'shared' (PAN) até alguém da PAN anexar um novo.
-- px_roster_leaders: gerência de cada liderança, por carteira.
-- px_drop_reviews.portfolio: carteira do atendimento (de quem importou ou lançou). O IdContato só é único
--                            dentro da carteira.
-- Pode ser executado mais de uma vez.

alter table public.px_profiles add column if not exists portfolio text;

alter table public.px_roster add column if not exists scope text not null default 'shared';
alter table public.px_roster add column if not exists portfolio text not null default 'PAN';
alter table public.px_roster drop constraint if exists px_roster_pkey;
alter table public.px_roster add constraint px_roster_pkey primary key (scope, login);
create index if not exists px_roster_login_idx on public.px_roster (portfolio, login);

alter table public.px_roster_leaders add column if not exists portfolio text not null default 'PAN';
alter table public.px_roster_leaders drop constraint if exists px_roster_leaders_pkey;
alter table public.px_roster_leaders add constraint px_roster_leaders_pkey primary key (portfolio, leader);

alter table public.px_drop_reviews add column if not exists portfolio text not null default 'PAN';
drop index if exists public.px_drop_reviews_contact_idx;
create unique index if not exists px_drop_reviews_portfolio_contact_idx on public.px_drop_reviews (portfolio, contact_id);
create index if not exists px_drop_reviews_portfolio_idx on public.px_drop_reviews (portfolio);

-- Para marcar as analistas da carteira SAFRA direto pelo SQL (também dá pela tela Usuários & acessos):
--   update public.px_profiles set portfolio = 'SAFRA' where lower(email) in ('vitoria…@paschoalotto.com.br', 'isabela…@paschoalotto.com.br');

notify pgrst, 'reload schema';
