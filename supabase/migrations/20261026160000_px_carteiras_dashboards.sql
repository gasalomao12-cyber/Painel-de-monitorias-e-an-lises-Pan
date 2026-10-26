-- PX Monitorias & Feedbacks — carteiras PAN (Veículos, Cartões e Consignado) e importação
-- dos dashboards de monitoria já trabalhados (speech de Veículos e roteiro Sem Garantia).
-- Pode ser executado mais de uma vez.

-- ---------------------------------------------------------------- Produtos e segmentos
-- Veículos (speech E.A. e refin), Cartões (Clean Curto / Clean Longo) e Consignado (Público / Privado).
-- Refinanciamento e Entrega Amigável continuam valendo para monitorias lançadas à mão.
alter table public.px_evaluations drop constraint if exists px_evaluations_product_check;
alter table public.px_evaluations add constraint px_evaluations_product_check
  check (product in ('REFIN','ENTREGA','VEICULOS','CARTOES','CONSIGNADO'));
alter table public.px_criteria drop constraint if exists px_criteria_product_check;
alter table public.px_criteria add constraint px_criteria_product_check
  check (product in ('REFIN','ENTREGA','AMBOS','VEICULOS','SEM_GARANTIA','CARTOES','CONSIGNADO'));

alter table public.px_evaluations add column if not exists segment text;
alter table public.px_evaluations drop constraint if exists px_evaluations_segment_check;
alter table public.px_evaluations add constraint px_evaluations_segment_check
  check (segment is null or segment in ('CLEAN_CURTO','CLEAN_LONGO','PUBLICO','PRIVADO'));

-- ---------------------------------------------------------------- Dados que os dashboards já trazem
alter table public.px_criteria add column if not exists stage text;

alter table public.px_operators add column if not exists login text;
alter table public.px_operators add column if not exists manager_name text;
create index if not exists px_operators_login_idx on public.px_operators (lower(login));

alter table public.px_evaluations add column if not exists source text;        -- ex.: dash_veiculos, dash_sem_garantia
alter table public.px_evaluations add column if not exists external_id text;   -- id da ligação no discador
alter table public.px_evaluations add column if not exists call_time text;     -- HH:MM
alter table public.px_evaluations add column if not exists campaign text;
alter table public.px_evaluations add column if not exists channel text;       -- AGV / Convencional
alter table public.px_evaluations add column if not exists tabulation text;    -- finalização do operador
alter table public.px_evaluations add column if not exists outcome text;       -- desfecho da conversa
alter table public.px_evaluations add column if not exists effort text;        -- esforço negocial A/M/B/Z
alter table public.px_evaluations add column if not exists audio_file text;    -- nome do .wav na pasta do ciclo
alter table public.px_evaluations add column if not exists apt_ea boolean;
alter table public.px_evaluations add column if not exists apt_refin boolean;
alter table public.px_evaluations add column if not exists alerts text[] not null default '{}';
alter table public.px_evaluations add column if not exists details jsonb;
create unique index if not exists px_evaluations_external_idx on public.px_evaluations (source, external_id);
create index if not exists px_evaluations_product_idx on public.px_evaluations (product, segment);

-- ---------------------------------------------------------------- Roteiros
-- Nota = % dos itens do roteiro feitos, entre os que cabiam na ligação (peso 1 cada; N/A sai da base).
-- Itens com peso 0 aparecem na monitoria, mas ficam fora da nota, como nos dashboards.
insert into public.px_criteria (product, code, name, description, weight, critical, sort, stage)
select v.product, v.code, v.name, v.description, v.weight, false, v.sort, v.stage
from (values
  ('VEICULOS', 'CTR', 'Citou o contrato do veículo', 'Exemplo: "É sobre o financiamento do seu [veículo] com o Banco PAN."', 1, 1, 'Abertura'),
  ('VEICULOS', 'ATR', 'Informou atraso ou valor', 'Exemplo: "O contrato está com 3 parcelas em atraso, hoje no valor de R$ ..."', 1, 2, 'Abertura'),
  ('VEICULOS', 'GRV', 'Avisou que a ligação é gravada', 'Exemplo: "Informo que esta ligação está sendo gravada."', 1, 3, 'Abertura'),
  ('VEICULOS', 'SMO', 'Perguntou o motivo do atraso', 'Exemplo: "O que aconteceu que impediu o pagamento?" Não conta com finalização de descarte.', 1, 4, 'Sondagem'),
  ('VEICULOS', 'SQQ', 'Perguntou quanto ou quando consegue', 'Exemplo: "Até quando o senhor consegue? Qual valor cabe hoje?"', 1, 5, 'Sondagem'),
  ('VEICULOS', 'PRP', 'Fez proposta com valor', 'Exemplo: "A parcela fica R$ 850,00 com vencimento amanhã." Conta como feita quando houve acordo ou recusa de uma proposta.', 1, 6, 'Negociação'),
  ('VEICULOS', 'ALT', 'Outra opção depois do "não"', 'Depois do "não": outra data, uma parcela, quitação, refin ou entrega amigável.', 1, 7, 'Negociação'),
  ('VEICULOS', 'OEA', 'Ofertou a entrega amigável', 'Só conta para cliente apto à E.A. Cliente que não consegue manter o veículo: "o banco tem a entrega amigável, que quita a dívida".', 1, 8, 'E.A. e refin'),
  ('VEICULOS', 'ORF', 'Ofertou o refinanciamento', 'Só conta para cliente apto ao refin (não vale em ajuizados). Cliente que não consegue pagar as atrasadas: oferte o refin com entrada e parcela.', 1, 9, 'E.A. e refin'),
  ('VEICULOS', 'BEN', 'Citou benefício de pagar', 'Exemplo: "Regularizando, para de correr juros e o nome sai da restrição."', 1, 10, 'Argumentação'),
  ('VEICULOS', 'CSQ', 'Explicou as consequências', 'Exemplo: "Sem acordo, os juros continuam e o contrato pode ir para busca e apreensão." Não conta quando houve acordo.', 1, 11, 'Argumentação'),
  ('VEICULOS', 'CFA', 'Confirmou valor e data do acordo', 'Exemplo: "O acordo ficou em R$ ..., com vencimento em ..., correto?"', 1, 12, 'Fechamento'),
  ('VEICULOS', 'POS', 'Postura respeitosa', 'Ouvir sem interromper, sem ironia e sem ameaça. Acompanhada à parte: não entra na nota.', 0, 13, 'Postura'),

  ('SEM_GARANTIA', 'APR', 'Apresentação e aviso de gravação', 'Exemplo: "Meu nome é ..., falo da Paschoalotto, representante do Banco PAN. Informo que esta ligação está sendo gravada." Cabe sempre que o operador falou com alguém.', 1, 1, 'Iniciação'),
  ('SEM_GARANTIA', 'CPF', 'Confirmação positiva (CPF)', 'Exemplo: "Para sua segurança, poderia me confirmar os três primeiros dígitos do seu CPF?" Cabe quando quem atendeu é o titular, antes de expor a dívida.', 1, 2, 'Iniciação'),
  ('SEM_GARANTIA', 'DIV', 'Dados da dívida e valor', 'Exemplo: "O motivo do meu contato é o seu (produto), em atraso há X dias, hoje no valor de R$ ..." Cabe com o titular confirmado; não cabe se o cliente já chegou dizendo que pagou.', 1, 3, 'Iniciação'),
  ('SEM_GARANTIA', 'SMO', 'Perguntou o motivo do atraso', 'Exemplo: "Para melhor ajudá-lo, qual foi o motivo do atraso?" No consignado: férias, faltas, afastamento, contracheque. Não cabe quando o cliente contou o motivo sozinho ou a conversa não deu espaço.', 1, 4, 'Sondagem'),
  ('SEM_GARANTIA', 'SQQ', 'Perguntou quanto ou quando consegue', 'Exemplo: "Qual valor o senhor dispõe hoje para negociarmos?" ou "até quando consegue?" Não cabe se o cliente já disse valor e data sozinho.', 1, 5, 'Sondagem'),
  ('SEM_GARANTIA', 'PRP', 'Fez proposta com valor ou data', 'Sempre apresentar uma proposta concreta (valor e data) antes de encerrar. Acompanhada no esforço negocial: não entra na nota de aderência.', 0, 6, 'Negociação'),
  ('SEM_GARANTIA', 'ALT', 'Outra opção depois do "não"', 'Gradatividade: depois do "não", trazer outra condição (mínimo, intermediário, parcelamento, quitação, data mais próxima). Cabe só quando o cliente recusou a primeira proposta.', 1, 7, 'Negociação'),
  ('SEM_GARANTIA', 'BEN', 'Citou benefício de pagar', 'Exemplo: "Regularizando hoje, evita juros, interrompe as ligações e pode retirar o nome das restrições." Cabe quando houve negociação.', 1, 8, 'Argumentação'),
  ('SEM_GARANTIA', 'CSQ', 'Explicou as consequências', 'Exemplo: "Sem acordo, as ligações e os juros continuam e o nome permanece negativado." Cabe só quando não houve acordo e havia negociação.', 1, 9, 'Argumentação'),
  ('SEM_GARANTIA', 'CFA', 'Confirmou valor e data do acordo', 'Exemplo: "O acordo foi formalizado no valor de R$ ..., com pagamento no dia ..., correto?" Cabe só quando houve acordo com boleto ou Pix.', 1, 10, 'Fechamento'),
  ('SEM_GARANTIA', 'CAD', 'Atualizou o cadastro', 'Exemplo: "Seu telefone continua sendo ...? Seu e-mail permanece o mesmo?" Cabe quando houve acordo ou promessa e a ligação chegou ao fechamento.', 1, 11, 'Fechamento')
) as v(product, code, name, description, weight, sort, stage)
where not exists (select 1 from public.px_criteria c where c.product = v.product and c.code = v.code);

-- ---------------------------------------------------------------- Views (colunas novas no fim)
create or replace view public.px_v_eval_cards with (security_invoker = true) as
select e.id, e.cycle_id, e.operator_id, e.product, e.call_date, e.protocol, e.contract, e.customer, e.duration_sec,
       e.speech_score, e.final_score, e.status, e.ai_status, e.reviewed_at, e.created_at, e.updated_at, e.audio_url,
       c.audio_folder_url as cycle_audio_url, c.name as cycle_name, c.start_date as cycle_start,
       coalesce(nullif(e.audio_url, ''), c.audio_folder_url) as audio_link,
       (e.transcript is not null and e.transcript <> '') as has_transcript,
       o.name as operator_name, o.registration, o.team, o.supervisor_name, o.supervisor_user_id,
       coalesce(s.adjustments, 0) as adjustments, coalesce(s.ai_divergences, 0) as ai_divergences,
       coalesce(s.nc_count, 0) as nc_count, coalesce(s.c_count, 0) as c_count, coalesce(s.p_count, 0) as p_count,
       coalesce(s.critical_fail, 0) as critical_fail,
       fb.id as feedback_id, fb.applied_at as feedback_at, fb.by_display as feedback_by_display, fb.by_name as feedback_by,
       e.segment, e.source, e.external_id, e.call_time, e.campaign, e.channel, e.tabulation, e.outcome, e.effort,
       e.audio_file, e.apt_ea, e.apt_refin, e.alerts, o.login, o.manager_name
from public.px_evaluations e
join public.px_operators o on o.id = e.operator_id
left join public.px_cycles c on c.id = e.cycle_id
left join lateral (
  select count(*) filter (where i.adjusted)::int as adjustments,
         count(*) filter (where i.ai_result is not null and i.ai_result is distinct from i.speech_result)::int as ai_divergences,
         count(*) filter (where i.final_result = 'NC')::int as nc_count,
         count(*) filter (where i.final_result = 'C')::int as c_count,
         count(*) filter (where i.final_result = 'P')::int as p_count,
         count(*) filter (where i.final_result = 'NC' and cr.critical)::int as critical_fail
  from public.px_evaluation_items i join public.px_criteria cr on cr.id = i.criterion_id
  where i.evaluation_id = e.id
) s on true
left join lateral (
  select f.id, f.applied_at, p.display_name as by_display, p.name as by_name
  from public.px_feedbacks f left join public.px_profiles p on p.id = f.applied_by
  where f.evaluation_id = e.id order by f.applied_at desc limit 1
) fb on true;

create or replace view public.px_v_item_facts with (security_invoker = true) as
select i.id, i.evaluation_id, i.speech_result, i.final_result, i.adjusted, i.adjust_source,
       cr.id as criterion_id, cr.code, cr.name, cr.critical, cr.product as criterion_product, cr.sort,
       e.cycle_id, e.product, e.operator_id, e.status, e.final_score, e.call_date, e.protocol, e.customer, e.contract,
       o.team, o.supervisor_user_id, o.name as operator_name, o.registration,
       e.segment, cr.weight, cr.stage
from public.px_evaluation_items i
join public.px_criteria cr on cr.id = i.criterion_id
join public.px_evaluations e on e.id = i.evaluation_id
join public.px_operators o on o.id = e.operator_id;

create or replace view public.px_v_eval_items with (security_invoker = true) as
select i.*, cr.code, cr.name, cr.description, cr.weight, cr.critical, cr.product as criterion_product, cr.sort,
       p.display_name as adjusted_by_display, p.name as adjusted_by_name, cr.stage
from public.px_evaluation_items i
join public.px_criteria cr on cr.id = i.criterion_id
left join public.px_profiles p on p.id = i.adjusted_by;

create or replace view public.px_v_feedbacks with (security_invoker = true) as
select f.*, o.name as operator_name, o.team, o.registration, o.supervisor_user_id,
       e.product, e.call_date, e.protocol, e.final_score, e.speech_score, e.cycle_id, c.name as cycle_name,
       p.name as applied_by_name, p.display_name as applied_by_display, p.role as applied_by_role, e.segment
from public.px_feedbacks f
join public.px_evaluations e on e.id = f.evaluation_id
join public.px_operators o on o.id = f.operator_id
left join public.px_cycles c on c.id = e.cycle_id
left join public.px_profiles p on p.id = f.applied_by;

revoke all on public.px_v_eval_cards, public.px_v_item_facts, public.px_v_eval_items, public.px_v_feedbacks from anon, authenticated;
grant select on public.px_v_eval_cards, public.px_v_item_facts, public.px_v_eval_items, public.px_v_feedbacks to service_role;

notify pgrst, 'reload schema';
