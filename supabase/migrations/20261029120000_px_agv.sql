-- PX Monitorias & Feedbacks — divisão AGV (ligações que começam com a assistente virtual e são
-- transferidas para o operador). Roteiro próprio, com as mesmas perguntas do relatório do speech
-- "PAN TESTE DE PERGUNTAS AGV", para comparar carteiras, campanhas, equipes, operadores e períodos.
-- Pode ser executado mais de uma vez.

alter table public.px_criteria drop constraint if exists px_criteria_product_check;
alter table public.px_criteria add constraint px_criteria_product_check
  check (product in ('REFIN','ENTREGA','AMBOS','VEICULOS','SEM_GARANTIA','CARTOES','CONSIGNADO','AGV'));

-- Avalia só o operador, a partir da transferência. Peso 1 cada; N/A sai da base.
-- O desfecho (acordo com boleto, promessa, retorno, sem acordo) fica no campo "desfecho" da ligação.
insert into public.px_criteria (product, code, name, description, weight, critical, sort, stage)
select v.product, v.code, v.name, v.description, v.weight, false, v.sort, v.stage
from (values
  ('AGV', 'APR', 'Disse o nome e a empresa', 'SIM: disse o próprio nome e a empresa (Paschoalotto ou Banco PAN). NÃO: faltou o nome ou a empresa.', 1, 1, 'Abertura'),
  ('AGV', 'ATR', 'Informou o que está em atraso', 'SIM: citou o produto (financiamento, veículo, cartão ou fatura) e os dias, as parcelas ou o valor em atraso. N/A: o cliente disse que já pagou, interrompeu antes, ou a assistente virtual já informou a dívida.', 1, 2, 'Abertura'),
  ('AGV', 'SMO', 'Perguntou o motivo do atraso', 'SIM: abriu espaço para o cliente explicar (o que aconteceu, algum imprevisto, como está a situação). Perguntar só se já pagou não conta. N/A: sem negociação com o titular ou o cliente explicou sozinho.', 1, 3, 'Sondagem'),
  ('AGV', 'SQQ', 'Perguntou quanto ou quando consegue', 'SIM: perguntou uma data (quando recebe, melhor dia) ou um valor (quanto consegue, quanto de entrada). N/A: sem negociação ou o cliente aceitou a primeira proposta já dizendo valor e data.', 1, 4, 'Sondagem'),
  ('AGV', 'PRP', 'Ofereceu pagamento com valor', 'SIM: ofereceu quitação, parcelas, entrada, parcelamento, refin ou acordo com valor em reais. Só informar o valor da dívida não conta. N/A: sem negociação com o titular.', 1, 5, 'Negociação'),
  ('AGV', 'ALT', 'Outra condição depois do "não"', 'SIM: após a recusa, ofereceu outro valor, uma parte, outra data, parcelamento, desconto, refin ou entrega amigável. N/A: sem negociação, sem proposta ou o cliente aceitou a primeira.', 1, 6, 'Negociação'),
  ('AGV', 'BEN', 'Citou benefício de pagar', 'SIM: parar os juros, evitar encargos, limpar o nome, parar as ligações, ficar em dia ou desconto que vale hoje. N/A: sem negociação com o titular.', 1, 7, 'Argumentação'),
  ('AGV', 'CSQ', 'Explicou as consequências', 'SIM: explicou com calma juros que continuam, nome negativado, perda das condições, busca e apreensão ou cobrança judicial. Ameaça conta como não feito. N/A: houve acordo ou não houve negociação com o titular.', 1, 8, 'Argumentação'),
  ('AGV', 'CFA', 'Repetiu valor e data do acordo', 'SIM: repetiu o valor e a data perto do fechamento. Só o valor ou só a data não conta. N/A: não houve acordo com boleto.', 1, 9, 'Fechamento')
) as v(product, code, name, description, weight, sort, stage)
where not exists (select 1 from public.px_criteria c where c.product = v.product and c.code = v.code);

create index if not exists px_evaluations_channel_idx on public.px_evaluations (channel, product);

-- Ligações AGV vindas do discador que ainda não foram avaliadas passam para o roteiro AGV
delete from public.px_evaluation_items i
using public.px_evaluations e, public.px_criteria cr
where i.evaluation_id = e.id and cr.id = i.criterion_id and e.source = 'discador' and e.channel = 'AGV'
  and cr.product <> 'AGV'
  and not exists (select 1 from public.px_evaluation_items x where x.evaluation_id = e.id and (x.final_result is not null or x.speech_result is not null));
insert into public.px_evaluation_items (evaluation_id, criterion_id)
select e.id, cr.id from public.px_evaluations e cross join public.px_criteria cr
where e.source = 'discador' and e.channel = 'AGV' and cr.product = 'AGV' and cr.active
  and not exists (select 1 from public.px_evaluation_items x where x.evaluation_id = e.id);

-- Canal e campanha também nos fatos por item (filtros e comparativos)
create or replace view public.px_v_item_facts with (security_invoker = true) as
select i.id, i.evaluation_id, i.speech_result, i.final_result, i.adjusted, i.adjust_source,
       cr.id as criterion_id, cr.code, cr.name, cr.critical, cr.product as criterion_product, cr.sort,
       e.cycle_id, e.product, e.operator_id, e.status, e.final_score, e.call_date, e.protocol, e.customer, e.contract,
       o.team, o.supervisor_user_id, o.name as operator_name, o.registration,
       e.segment, cr.weight, cr.stage, e.channel, e.campaign
from public.px_evaluation_items i
join public.px_criteria cr on cr.id = i.criterion_id
join public.px_evaluations e on e.id = i.evaluation_id
join public.px_operators o on o.id = e.operator_id;
revoke all on public.px_v_item_facts from anon, authenticated;
grant select on public.px_v_item_facts to service_role;

notify pgrst, 'reload schema';
