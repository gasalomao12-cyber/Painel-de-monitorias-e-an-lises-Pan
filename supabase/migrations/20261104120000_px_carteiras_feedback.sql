-- PX Monitorias & Feedbacks — carteiras (PAN, SAFRA, PORTO) em toda a plataforma e feedback por operador.
-- px_operators.portfolio: carteira do operador (as monitorias, análises e feedbacks seguem o operador).
--   Usuários de Qualidade e Supervisão veem só a própria carteira (px_profiles.portfolio; vazio = PAN).
-- px_operators.feedback_excluded_*: operador tirado da lista de feedbacks pendentes (remanejado, desligado…).
-- px_feedbacks.batch_id: um feedback aplicado a vários atendimentos de uma vez (um por operador).
-- Roda no Supabase e no PostgreSQL do servidor próprio. Pode ser executado mais de uma vez.

alter table public.px_operators add column if not exists portfolio text not null default 'PAN';
alter table public.px_operators add column if not exists feedback_excluded_at timestamptz;
alter table public.px_operators add column if not exists feedback_excluded_reason text;
alter table public.px_operators add column if not exists feedback_excluded_by uuid references public.px_profiles(id) on delete set null;
create index if not exists px_operators_portfolio_idx on public.px_operators (portfolio);
alter table public.px_feedbacks add column if not exists batch_id uuid;
create index if not exists px_feedbacks_batch_idx on public.px_feedbacks (batch_id);

-- As views ganham a carteira do operador no fim da lista de colunas


create or replace view public.px_v_eval_cards with (security_invoker = true) as
SELECT e.id,
    e.cycle_id,
    e.operator_id,
    e.product,
    e.call_date,
    e.protocol,
    e.contract,
    e.customer,
    e.duration_sec,
    e.speech_score,
    e.final_score,
    e.status,
    e.ai_status,
    e.reviewed_at,
    e.created_at,
    e.updated_at,
    e.audio_url,
    c.audio_folder_url AS cycle_audio_url,
    c.name AS cycle_name,
    c.start_date AS cycle_start,
    COALESCE(NULLIF(e.audio_url, ''::text), c.audio_folder_url) AS audio_link,
    e.transcript IS NOT NULL AND e.transcript <> ''::text AS has_transcript,
    o.name AS operator_name,
    o.registration,
    o.team,
    o.supervisor_name,
    o.supervisor_user_id,
    COALESCE(s.adjustments, 0) AS adjustments,
    COALESCE(s.ai_divergences, 0) AS ai_divergences,
    COALESCE(s.nc_count, 0) AS nc_count,
    COALESCE(s.c_count, 0) AS c_count,
    COALESCE(s.p_count, 0) AS p_count,
    COALESCE(s.critical_fail, 0) AS critical_fail,
    fb.id AS feedback_id,
    fb.applied_at AS feedback_at,
    fb.by_display AS feedback_by_display,
    fb.by_name AS feedback_by,
    e.segment,
    e.source,
    e.external_id,
    e.call_time,
    e.campaign,
    e.channel,
    e.tabulation,
    e.outcome,
    e.effort,
    e.audio_file,
    e.apt_ea,
    e.apt_refin,
    e.alerts,
    o.login,
    o.manager_name,
    ( SELECT ct.status
           FROM px_contests ct
          WHERE ct.evaluation_id = e.id AND ct.status <> 'cancelada'::text
          ORDER BY ct.created_at DESC
         LIMIT 1) AS contest_status, o.portfolio, o.feedback_excluded_at
   FROM px_evaluations e
     JOIN px_operators o ON o.id = e.operator_id
     LEFT JOIN px_cycles c ON c.id = e.cycle_id
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE i.adjusted)::integer AS adjustments,
            count(*) FILTER (WHERE i.ai_result IS NOT NULL AND i.ai_result IS DISTINCT FROM i.speech_result)::integer AS ai_divergences,
            count(*) FILTER (WHERE i.final_result = 'NC'::text)::integer AS nc_count,
            count(*) FILTER (WHERE i.final_result = 'C'::text)::integer AS c_count,
            count(*) FILTER (WHERE i.final_result = 'P'::text)::integer AS p_count,
            count(*) FILTER (WHERE i.final_result = 'NC'::text AND cr.critical)::integer AS critical_fail
           FROM px_evaluation_items i
             JOIN px_criteria cr ON cr.id = i.criterion_id
          WHERE i.evaluation_id = e.id) s ON true
     LEFT JOIN LATERAL ( SELECT f.id,
            f.applied_at,
            p.display_name AS by_display,
            p.name AS by_name
           FROM px_feedbacks f
             LEFT JOIN px_profiles p ON p.id = f.applied_by
          WHERE f.evaluation_id = e.id
          ORDER BY f.applied_at DESC
         LIMIT 1) fb ON true;

create or replace view public.px_v_item_facts with (security_invoker = true) as
SELECT i.id,
    i.evaluation_id,
    i.speech_result,
    i.final_result,
    i.adjusted,
    i.adjust_source,
    cr.id AS criterion_id,
    cr.code,
    cr.name,
    cr.critical,
    cr.product AS criterion_product,
    cr.sort,
    e.cycle_id,
    e.product,
    e.operator_id,
    e.status,
    e.final_score,
    e.call_date,
    e.protocol,
    e.customer,
    e.contract,
    o.team,
    o.supervisor_user_id,
    o.name AS operator_name,
    o.registration,
    e.segment,
    cr.weight,
    cr.stage,
    e.channel,
    e.campaign, o.portfolio
   FROM px_evaluation_items i
     JOIN px_criteria cr ON cr.id = i.criterion_id
     JOIN px_evaluations e ON e.id = i.evaluation_id
     JOIN px_operators o ON o.id = e.operator_id;

create or replace view public.px_v_feedbacks with (security_invoker = true) as
SELECT f.id,
    f.evaluation_id,
    f.operator_id,
    f.applied_by,
    f.applied_at,
    f.modality,
    f.content,
    f.strengths,
    f.improvements,
    f.action_plan,
    f.operator_ack,
    f.followup_date,
    f.created_at,
    f.updated_at,
    o.name AS operator_name,
    o.team,
    o.registration,
    o.supervisor_user_id,
    e.product,
    e.call_date,
    e.protocol,
    e.final_score,
    e.speech_score,
    e.cycle_id,
    c.name AS cycle_name,
    p.name AS applied_by_name,
    p.display_name AS applied_by_display,
    p.role AS applied_by_role,
    e.segment, o.portfolio, f.batch_id
   FROM px_feedbacks f
     JOIN px_evaluations e ON e.id = f.evaluation_id
     JOIN px_operators o ON o.id = f.operator_id
     LEFT JOIN px_cycles c ON c.id = e.cycle_id
     LEFT JOIN px_profiles p ON p.id = f.applied_by;

create or replace view public.px_v_contests with (security_invoker = true) as
SELECT ct.id,
    ct.evaluation_id,
    ct.requested_by,
    ct.reason,
    ct.criteria,
    ct.status,
    ct.response,
    ct.responded_by,
    ct.responded_at,
    ct.created_at,
    e.product,
    e.segment,
    e.call_date,
    e.protocol,
    e.final_score,
    e.cycle_id,
    e.operator_id,
    e.status AS evaluation_status,
    o.name AS operator_name,
    o.team,
    o.supervisor_user_id,
    o.supervisor_name,
    rq.name AS requested_by_name,
    rq.display_name AS requested_by_display,
    rs.name AS responded_by_name,
    rs.display_name AS responded_by_display, o.portfolio
   FROM px_contests ct
     JOIN px_evaluations e ON e.id = ct.evaluation_id
     JOIN px_operators o ON o.id = e.operator_id
     LEFT JOIN px_profiles rq ON rq.id = ct.requested_by
     LEFT JOIN px_profiles rs ON rs.id = ct.responded_by;

create or replace view public.px_v_actions with (security_invoker = true) as
SELECT a.id,
    a.created_at,
    a.action_date,
    a.operator_id,
    a.login,
    a.segment_label,
    a.theme,
    a.action,
    a.obs,
    a.responsible,
    a.responsible_user,
    a.source,
    a.evaluation_id,
    a.feedback_id,
    a.contest_id,
    a.dedupe_key,
    a.sync_status,
    a.sync_error,
    a.sync_attempts,
    a.sync_started_at,
    a.synced_at,
    o.name AS operator_name,
    o.team,
    o.supervisor_user_id,
    o.supervisor_name,
    p.name AS responsible_name,
    p.display_name AS responsible_display,
    e.protocol,
    e.product,
    e.segment, o.portfolio
   FROM px_actions a
     LEFT JOIN px_operators o ON o.id = a.operator_id
     LEFT JOIN px_profiles p ON p.id = a.responsible_user
     LEFT JOIN px_evaluations e ON e.id = a.evaluation_id;


notify pgrst, 'reload schema';
