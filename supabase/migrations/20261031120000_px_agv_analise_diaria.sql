-- PX Monitorias & Feedbacks — análises AGV fora das quinzenas.
-- As ligações AGV avaliadas nos roteiros AGV são agrupadas por análise (dia ou período do arquivo importado),
-- não por quinzena. Ligações AGV de dashboards de monitoria quinzenal (roteiro de Veículos) continuam na quinzena.
-- Pode ser executado mais de uma vez.
update public.px_evaluations e set cycle_id = null
where e.channel = 'AGV' and e.cycle_id is not null
  and exists (select 1 from public.px_evaluation_items i join public.px_criteria c on c.id = i.criterion_id
              where i.evaluation_id = e.id and c.product in ('AGV', 'AGV2'));
