-- =====================================================================================
-- PX Monitorias & Feedbacks — SQL completo do banco (todas as migrações, em ordem)
-- Gerado a partir de supabase/migrations/ em 30/10/2026. Pode ser rodado mais de uma vez.
--
-- ONDE RODAR: no PostgreSQL do Supabase self-hosted instalado no servidor da Paschoalotto
-- (container supabase-db). O script usa os recursos que o Supabase cria no mesmo banco:
--   auth.users (login), storage.buckets (áudios), realtime.send (telas ao vivo)
--   e os papéis anon, authenticated e service_role.
-- Num PostgreSQL "puro", sem o Supabase, ele não roda: o login, os arquivos e o tempo real
-- da plataforma dependem desses serviços.
--
-- COMO RODAR (na VM):
--   docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 < px_monitorias_completo.sql
-- Depois, crie o primeiro administrador (usuário já criado em Authentication › Users):
--   select public.px_bootstrap_admin('e-mail do administrador', 'Nome do administrador');
--
-- Os DADOS (usuários, monitorias, análises) não estão aqui: veja implantacao-vm/sql/LEIA-ME_SQL.md.
-- =====================================================================================

-- As views px_v_* são recriadas pelas migrações abaixo (algumas mudam de colunas ao longo delas).
-- Derrubá-las antes deixa o script rodar de novo sobre um banco que já está na versão final.
-- Views não guardam dados.
do $$ declare r record; begin
  for r in select viewname v from pg_views where schemaname = 'public' and viewname like 'px\_v\_%' loop
    execute format('drop view if exists public.%I cascade', r.v);
  end loop;
end $$;

-- Registro das migrações aplicadas: o scripts/aplicar-migracoes.sh roda depois só as novas.
create table if not exists public.px_schema_migrations (version text primary key, applied_at timestamptz not null default now());
alter table public.px_schema_migrations enable row level security;
