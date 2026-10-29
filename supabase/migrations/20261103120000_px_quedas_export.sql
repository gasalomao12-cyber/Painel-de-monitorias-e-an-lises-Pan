-- PX Monitorias & Feedbacks — força-tarefa de queda: carteira analisada e campos da planilha de controle.
-- carteira: carteira do atendimento (SAFRA BS, SAFRA ADM, PAN CONTACT, PAN MASSIFICADOS,
--           PAN ATIVAS E AJUIZADOS, PORTO), usada na visão consolidada/apartada e no CSV.
-- phone: telefone da ligação (coluna "Telefone" da planilha).
-- attended / held: "Prestou atendimento?" e "Segurou ligação?".
-- Pode ser executado mais de uma vez.

alter table public.px_drop_reviews add column if not exists carteira text;
alter table public.px_drop_reviews add column if not exists phone text;
alter table public.px_drop_reviews add column if not exists attended boolean;
alter table public.px_drop_reviews add column if not exists held boolean;
create index if not exists px_drop_reviews_carteira_idx on public.px_drop_reviews (carteira);

notify pgrst, 'reload schema';
