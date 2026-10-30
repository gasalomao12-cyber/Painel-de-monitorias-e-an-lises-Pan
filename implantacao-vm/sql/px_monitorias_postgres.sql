-- =====================================================================================
-- PX Monitorias & Feedbacks — banco completo para PostgreSQL (sem Supabase)
-- Gerado em 30/10/2026 a partir do schema em uso. PostgreSQL 14 ou mais novo.
--
-- COMO RODAR (banco vazio, criado para a plataforma):
--   createdb -U postgres px_monitorias
--   psql -U postgres -d px_monitorias -v ON_ERROR_STOP=1 -f px_monitorias_postgres.sql
-- Primeiro administrador (troca a senha no primeiro acesso):
--   select public.px_bootstrap_admin('e-mail', 'Nome', 'senha-provisoria');
-- Dados vindos do Supabase: veja servidor/LEIA-ME.md (exportar/importar).
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- senhas (bcrypt) e gen_random_uuid()

-- Login próprio da plataforma (substitui o Supabase Auth). Senhas em bcrypt.
CREATE TABLE IF NOT EXISTS public.px_auth_users (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL UNIQUE,
    encrypted_password text,
    email_confirmed_at timestamp with time zone,
    banned_until timestamp with time zone,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
-- Sessões (tokens de renovação, guardados só como hash)
CREATE TABLE IF NOT EXISTS public.px_auth_refresh (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.px_auth_users(id) ON DELETE CASCADE,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS px_auth_refresh_user_idx ON public.px_auth_refresh (user_id);

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: px_bootstrap_admin(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.px_bootstrap_admin(p_email text, p_name text, p_password text) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare uid uuid;
begin
  if length(coalesce(p_password, '')) < 8 then return 'Informe uma senha com pelo menos 8 caracteres.'; end if;
  insert into public.px_auth_users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
  values (lower(trim(p_email)), crypt(p_password, gen_salt('bf', 10)), now(), jsonb_build_object('name', p_name))
  on conflict (email) do update set encrypted_password = excluded.encrypted_password, banned_until = null
  returning id into uid;
  insert into public.px_profiles (id, email, name, role, must_change_password, active)
  values (uid, lower(trim(p_email)), coalesce(nullif(trim(p_name), ''), 'Administrador'), 'admin', true, true)
  on conflict (id) do update set role = 'admin', active = true, must_change_password = true;
  return 'Pronto: ' || lower(trim(p_email)) || ' agora é administrador da PX Monitorias (troca a senha no primeiro acesso).';
end $$;


--
-- Name: px_broadcast_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.px_broadcast_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  -- Avisa o servidor (LISTEN px_updates), que repassa às telas abertas
  perform pg_notify('px_updates', json_build_object('table', tg_table_name, 'op', tg_op, 'at', now())::text);
  return null;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: px_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_actions (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    action_date date DEFAULT CURRENT_DATE NOT NULL,
    operator_id bigint,
    login text,
    segment_label text,
    theme text,
    action text NOT NULL,
    obs text,
    responsible text,
    responsible_user uuid,
    source text DEFAULT 'manual'::text NOT NULL,
    evaluation_id bigint,
    feedback_id bigint,
    contest_id bigint,
    dedupe_key text,
    sync_status text DEFAULT 'pendente'::text NOT NULL,
    sync_error text,
    sync_attempts integer DEFAULT 0 NOT NULL,
    sync_started_at timestamp with time zone,
    synced_at timestamp with time zone,
    CONSTRAINT px_actions_source_check CHECK ((source = ANY (ARRAY['feedback'::text, 'analise'::text, 'ia'::text, 'contestacao'::text, 'manual'::text]))),
    CONSTRAINT px_actions_sync_status_check CHECK ((sync_status = ANY (ARRAY['pendente'::text, 'enviando'::text, 'enviado'::text, 'erro'::text, 'ignorado'::text])))
);


--
-- Name: px_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_actions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_audit_log (
    id bigint NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text,
    entity_id bigint,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: px_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_audit_log ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_bugs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_bugs (
    id bigint NOT NULL,
    user_id uuid,
    title text NOT NULL,
    description text NOT NULL,
    severity text DEFAULT 'media'::text NOT NULL,
    page text,
    user_agent text,
    screenshot text,
    status text DEFAULT 'aberto'::text NOT NULL,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT px_bugs_status_check CHECK ((status = ANY (ARRAY['aberto'::text, 'em_analise'::text, 'resolvido'::text, 'descartado'::text])))
);


--
-- Name: px_bugs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_bugs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_bugs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_contests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_contests (
    id bigint NOT NULL,
    evaluation_id bigint NOT NULL,
    requested_by uuid,
    reason text NOT NULL,
    criteria jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'aberta'::text NOT NULL,
    response text,
    responded_by uuid,
    responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT px_contests_status_check CHECK ((status = ANY (ARRAY['aberta'::text, 'aceita'::text, 'recusada'::text, 'cancelada'::text])))
);


--
-- Name: px_contests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_contests ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_contests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_criteria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_criteria (
    id bigint NOT NULL,
    product text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    weight numeric DEFAULT 1 NOT NULL,
    critical boolean DEFAULT false NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    stage text,
    CONSTRAINT px_criteria_product_check CHECK ((product = ANY (ARRAY['REFIN'::text, 'ENTREGA'::text, 'AMBOS'::text, 'VEICULOS'::text, 'SEM_GARANTIA'::text, 'CARTOES'::text, 'CONSIGNADO'::text, 'AGV'::text, 'AGV2'::text])))
);


--
-- Name: px_criteria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_criteria ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_criteria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_cycles (
    id bigint NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    audio_folder_url text,
    status text DEFAULT 'aberto'::text NOT NULL,
    published_at timestamp with time zone,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT px_cycles_status_check CHECK ((status = ANY (ARRAY['aberto'::text, 'publicado'::text, 'encerrado'::text])))
);


--
-- Name: px_cycles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_cycles ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_cycles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_drop_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_drop_reviews (
    id bigint NOT NULL,
    contact_id text,
    call_at timestamp without time zone,
    duration_sec integer,
    login text,
    operator_name text,
    leader text,
    manager text,
    campaign text,
    segment text,
    dialer_campaign text,
    operation text,
    tabulation text,
    disconnect text,
    contract text,
    customer text,
    audio_file text,
    audio_original text,
    status text DEFAULT 'pendente'::text NOT NULL,
    verdict text,
    conduct boolean DEFAULT false NOT NULL,
    conduct_type text,
    tab_correct boolean,
    correct_tab text,
    drop_moment text,
    notes text,
    audio_url text,
    audio_path text,
    audio_name text,
    transcript text,
    transcript_name text,
    analyst_id uuid,
    analyst_name text,
    analyzed_at timestamp with time zone,
    locked_by uuid,
    locked_name text,
    locked_at timestamp with time zone,
    batch text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    portfolio text DEFAULT 'PAN'::text NOT NULL,
    carteira text,
    phone text,
    attended boolean,
    held boolean,
    CONSTRAINT px_drop_reviews_disconnect_check CHECK ((disconnect = ANY (ARRAY['Interna'::text, 'Externa'::text]))),
    CONSTRAINT px_drop_reviews_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'analisada'::text]))),
    CONSTRAINT px_drop_reviews_verdict_check CHECK ((verdict = ANY (ARRAY['cliente'::text, 'operador'::text, 'tecnica'::text, 'mudo'::text, 'concluido'::text, 'inconclusivo'::text])))
);


--
-- Name: px_drop_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_drop_reviews ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_drop_reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_evaluation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_evaluation_items (
    id bigint NOT NULL,
    evaluation_id bigint NOT NULL,
    criterion_id bigint NOT NULL,
    speech_result text,
    speech_note text,
    final_result text,
    adjusted boolean DEFAULT false NOT NULL,
    adjust_reason text,
    adjust_source text,
    adjusted_by uuid,
    adjusted_at timestamp with time zone,
    ai_result text,
    ai_evidence text,
    ai_reason text,
    ai_confidence numeric,
    CONSTRAINT px_evaluation_items_ai_result_check CHECK ((ai_result = ANY (ARRAY['C'::text, 'P'::text, 'NC'::text, 'NA'::text]))),
    CONSTRAINT px_evaluation_items_final_result_check CHECK ((final_result = ANY (ARRAY['C'::text, 'P'::text, 'NC'::text, 'NA'::text]))),
    CONSTRAINT px_evaluation_items_speech_result_check CHECK ((speech_result = ANY (ARRAY['C'::text, 'P'::text, 'NC'::text, 'NA'::text])))
);


--
-- Name: px_evaluation_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_evaluation_items ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_evaluation_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_evaluations (
    id bigint NOT NULL,
    cycle_id bigint,
    operator_id bigint NOT NULL,
    product text NOT NULL,
    call_date date,
    protocol text,
    contract text,
    customer text,
    duration_sec integer,
    audio_url text,
    speech_score numeric,
    final_score numeric,
    speech_summary text,
    status text DEFAULT 'pendente'::text NOT NULL,
    transcript text,
    transcript_name text,
    ai_status text DEFAULT 'nao_executada'::text NOT NULL,
    ai_summary jsonb,
    ai_model text,
    ai_ran_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    is_demo boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    segment text,
    source text,
    external_id text,
    call_time text,
    campaign text,
    channel text,
    tabulation text,
    outcome text,
    effort text,
    audio_file text,
    apt_ea boolean,
    apt_refin boolean,
    alerts text[] DEFAULT '{}'::text[] NOT NULL,
    details jsonb,
    CONSTRAINT px_evaluations_product_check CHECK ((product = ANY (ARRAY['REFIN'::text, 'ENTREGA'::text, 'VEICULOS'::text, 'CARTOES'::text, 'CONSIGNADO'::text]))),
    CONSTRAINT px_evaluations_segment_check CHECK (((segment IS NULL) OR (segment = ANY (ARRAY['CLEAN_CURTO'::text, 'CLEAN_LONGO'::text, 'PUBLICO'::text, 'PRIVADO'::text])))),
    CONSTRAINT px_evaluations_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'revisada'::text, 'feedback_aplicado'::text])))
);


--
-- Name: px_evaluations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_evaluations ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_evaluations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_feedbacks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_feedbacks (
    id bigint NOT NULL,
    evaluation_id bigint NOT NULL,
    operator_id bigint NOT NULL,
    applied_by uuid,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    modality text,
    content text NOT NULL,
    strengths text,
    improvements text,
    action_plan text,
    operator_ack boolean DEFAULT false NOT NULL,
    followup_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: px_feedbacks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_feedbacks ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_feedbacks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_notifications (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: px_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_notifications ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_operators (
    id bigint NOT NULL,
    name text NOT NULL,
    registration text,
    team text,
    supervisor_user_id uuid,
    supervisor_name text,
    active boolean DEFAULT true NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    login text,
    manager_name text
);


--
-- Name: px_operators_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.px_operators ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.px_operators_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: px_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    display_name text,
    role text NOT NULL,
    must_change_password boolean DEFAULT true NOT NULL,
    onboarded boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    theme text DEFAULT 'dark'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login timestamp with time zone,
    portfolio text,
    CONSTRAINT px_profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'qualidade'::text, 'supervisor'::text])))
);


--
-- Name: px_roster; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_roster (
    login text NOT NULL,
    name text NOT NULL,
    name_key text NOT NULL,
    registration text,
    shift text,
    status text,
    campaign text,
    segment text,
    leader text,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scope text DEFAULT 'shared'::text NOT NULL,
    portfolio text DEFAULT 'PAN'::text NOT NULL
);


--
-- Name: px_roster_leaders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_roster_leaders (
    leader text NOT NULL,
    manager text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    portfolio text DEFAULT 'PAN'::text NOT NULL
);


--
-- Name: px_schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_schema_migrations (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: px_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.px_settings (
    key text NOT NULL,
    value text
);


--
-- Name: px_v_actions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.px_v_actions WITH (security_invoker='true') AS
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
    e.segment
   FROM (((public.px_actions a
     LEFT JOIN public.px_operators o ON ((o.id = a.operator_id)))
     LEFT JOIN public.px_profiles p ON ((p.id = a.responsible_user)))
     LEFT JOIN public.px_evaluations e ON ((e.id = a.evaluation_id)));


--
-- Name: px_v_audit; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.px_v_audit WITH (security_invoker='true') AS
 SELECT a.id,
    a.user_id,
    a.action,
    a.entity,
    a.entity_id,
    a.detail,
    a.created_at,
    p.name AS user_name,
    p.display_name AS user_display
   FROM (public.px_audit_log a
     LEFT JOIN public.px_profiles p ON ((p.id = a.user_id)));


--
-- Name: px_v_bugs; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.px_v_bugs WITH (security_invoker='true') AS
 SELECT b.id,
    b.user_id,
    b.title,
    b.description,
    b.severity,
    b.page,
    b.user_agent,
    b.status,
    b.admin_notes,
    b.created_at,
    b.resolved_at,
    (b.screenshot IS NOT NULL) AS has_screenshot,
    p.name AS user_name,
    p.display_name AS user_display
   FROM (public.px_bugs b
     LEFT JOIN public.px_profiles p ON ((p.id = b.user_id)));


--
-- Name: px_v_contests; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.px_v_contests WITH (security_invoker='true') AS
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
    rs.display_name AS responded_by_display
   FROM ((((public.px_contests ct
     JOIN public.px_evaluations e ON ((e.id = ct.evaluation_id)))
     JOIN public.px_operators o ON ((o.id = e.operator_id)))
     LEFT JOIN public.px_profiles rq ON ((rq.id = ct.requested_by)))
     LEFT JOIN public.px_profiles rs ON ((rs.id = ct.responded_by)));


--
-- Name: px_v_eval_cards; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.px_v_eval_cards WITH (security_invoker='true') AS
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
    ((e.transcript IS NOT NULL) AND (e.transcript <> ''::text)) AS has_transcript,
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
           FROM public.px_contests ct
          WHERE ((ct.evaluation_id = e.id) AND (ct.status <> 'cancelada'::text))
          ORDER BY ct.created_at DESC
         LIMIT 1) AS contest_status
   FROM ((((public.px_evaluations e
     JOIN public.px_operators o ON ((o.id = e.operator_id)))
     LEFT JOIN public.px_cycles c ON ((c.id = e.cycle_id)))
     LEFT JOIN LATERAL ( SELECT (count(*) FILTER (WHERE i.adjusted))::integer AS adjustments,
            (count(*) FILTER (WHERE ((i.ai_result IS NOT NULL) AND (i.ai_result IS DISTINCT FROM i.speech_result))))::integer AS ai_divergences,
            (count(*) FILTER (WHERE (i.final_result = 'NC'::text)))::integer AS nc_count,
            (count(*) FILTER (WHERE (i.final_result = 'C'::text)))::integer AS c_count,
            (count(*) FILTER (WHERE (i.final_result = 'P'::text)))::integer AS p_count,
            (count(*) FILTER (WHERE ((i.final_result = 'NC'::text) AND cr.critical)))::integer AS critical_fail
           FROM (public.px_evaluation_items i
             JOIN public.px_criteria cr ON ((cr.id = i.criterion_id)))
          WHERE (i.evaluation_id = e.id)) s ON (true))
     LEFT JOIN LATERAL ( SELECT f.id,
            f.applied_at,
            p.display_name AS by_display,
            p.name AS by_name
           FROM (public.px_feedbacks f
             LEFT JOIN public.px_profiles p ON ((p.id = f.applied_by)))
          WHERE (f.evaluation_id = e.id)
          ORDER BY f.applied_at DESC
         LIMIT 1) fb ON (true));


--
-- Name: px_v_eval_items; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.px_v_eval_items WITH (security_invoker='true') AS
 SELECT i.id,
    i.evaluation_id,
    i.criterion_id,
    i.speech_result,
    i.speech_note,
    i.final_result,
    i.adjusted,
    i.adjust_reason,
    i.adjust_source,
    i.adjusted_by,
    i.adjusted_at,
    i.ai_result,
    i.ai_evidence,
    i.ai_reason,
    i.ai_confidence,
    cr.code,
    cr.name,
    cr.description,
    cr.weight,
    cr.critical,
    cr.product AS criterion_product,
    cr.sort,
    p.display_name AS adjusted_by_display,
    p.name AS adjusted_by_name,
    cr.stage
   FROM ((public.px_evaluation_items i
     JOIN public.px_criteria cr ON ((cr.id = i.criterion_id)))
     LEFT JOIN public.px_profiles p ON ((p.id = i.adjusted_by)));


--
-- Name: px_v_feedbacks; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.px_v_feedbacks WITH (security_invoker='true') AS
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
    e.segment
   FROM ((((public.px_feedbacks f
     JOIN public.px_evaluations e ON ((e.id = f.evaluation_id)))
     JOIN public.px_operators o ON ((o.id = f.operator_id)))
     LEFT JOIN public.px_cycles c ON ((c.id = e.cycle_id)))
     LEFT JOIN public.px_profiles p ON ((p.id = f.applied_by)));


--
-- Name: px_v_item_facts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.px_v_item_facts WITH (security_invoker='true') AS
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
    e.campaign
   FROM (((public.px_evaluation_items i
     JOIN public.px_criteria cr ON ((cr.id = i.criterion_id)))
     JOIN public.px_evaluations e ON ((e.id = i.evaluation_id)))
     JOIN public.px_operators o ON ((o.id = e.operator_id)));


--
-- Name: px_actions px_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_actions
    ADD CONSTRAINT px_actions_pkey PRIMARY KEY (id);


--
-- Name: px_audit_log px_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_audit_log
    ADD CONSTRAINT px_audit_log_pkey PRIMARY KEY (id);


--
-- Name: px_bugs px_bugs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_bugs
    ADD CONSTRAINT px_bugs_pkey PRIMARY KEY (id);


--
-- Name: px_contests px_contests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_contests
    ADD CONSTRAINT px_contests_pkey PRIMARY KEY (id);


--
-- Name: px_criteria px_criteria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_criteria
    ADD CONSTRAINT px_criteria_pkey PRIMARY KEY (id);


--
-- Name: px_cycles px_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_cycles
    ADD CONSTRAINT px_cycles_pkey PRIMARY KEY (id);


--
-- Name: px_drop_reviews px_drop_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_drop_reviews
    ADD CONSTRAINT px_drop_reviews_pkey PRIMARY KEY (id);


--
-- Name: px_evaluation_items px_evaluation_items_evaluation_id_criterion_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluation_items
    ADD CONSTRAINT px_evaluation_items_evaluation_id_criterion_id_key UNIQUE (evaluation_id, criterion_id);


--
-- Name: px_evaluation_items px_evaluation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluation_items
    ADD CONSTRAINT px_evaluation_items_pkey PRIMARY KEY (id);


--
-- Name: px_evaluations px_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluations
    ADD CONSTRAINT px_evaluations_pkey PRIMARY KEY (id);


--
-- Name: px_feedbacks px_feedbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_feedbacks
    ADD CONSTRAINT px_feedbacks_pkey PRIMARY KEY (id);


--
-- Name: px_notifications px_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_notifications
    ADD CONSTRAINT px_notifications_pkey PRIMARY KEY (id);


--
-- Name: px_operators px_operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_operators
    ADD CONSTRAINT px_operators_pkey PRIMARY KEY (id);


--
-- Name: px_profiles px_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_profiles
    ADD CONSTRAINT px_profiles_pkey PRIMARY KEY (id);


--
-- Name: px_roster_leaders px_roster_leaders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_roster_leaders
    ADD CONSTRAINT px_roster_leaders_pkey PRIMARY KEY (portfolio, leader);


--
-- Name: px_roster px_roster_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_roster
    ADD CONSTRAINT px_roster_pkey PRIMARY KEY (scope, login);


--
-- Name: px_schema_migrations px_schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_schema_migrations
    ADD CONSTRAINT px_schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: px_settings px_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_settings
    ADD CONSTRAINT px_settings_pkey PRIMARY KEY (key);


--
-- Name: px_actions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_actions_date_idx ON public.px_actions USING btree (action_date DESC, id DESC);


--
-- Name: px_actions_dedupe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX px_actions_dedupe_idx ON public.px_actions USING btree (dedupe_key);


--
-- Name: px_actions_operator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_actions_operator_idx ON public.px_actions USING btree (operator_id);


--
-- Name: px_actions_sync_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_actions_sync_idx ON public.px_actions USING btree (sync_status) WHERE (sync_status <> 'enviado'::text);


--
-- Name: px_audit_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_audit_entity_idx ON public.px_audit_log USING btree (entity, entity_id);


--
-- Name: px_contests_eval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_contests_eval_idx ON public.px_contests USING btree (evaluation_id, created_at DESC);


--
-- Name: px_contests_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX px_contests_open_idx ON public.px_contests USING btree (evaluation_id) WHERE (status = 'aberta'::text);


--
-- Name: px_contests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_contests_status_idx ON public.px_contests USING btree (status);


--
-- Name: px_drop_reviews_call_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_drop_reviews_call_idx ON public.px_drop_reviews USING btree (call_at DESC);


--
-- Name: px_drop_reviews_carteira_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_drop_reviews_carteira_idx ON public.px_drop_reviews USING btree (carteira);


--
-- Name: px_drop_reviews_login_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_drop_reviews_login_idx ON public.px_drop_reviews USING btree (login);


--
-- Name: px_drop_reviews_portfolio_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX px_drop_reviews_portfolio_contact_idx ON public.px_drop_reviews USING btree (portfolio, contact_id);


--
-- Name: px_drop_reviews_portfolio_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_drop_reviews_portfolio_idx ON public.px_drop_reviews USING btree (portfolio);


--
-- Name: px_evaluations_call_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_evaluations_call_date_idx ON public.px_evaluations USING btree (call_date DESC);


--
-- Name: px_evaluations_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_evaluations_channel_idx ON public.px_evaluations USING btree (channel, product);


--
-- Name: px_evaluations_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_evaluations_cycle_idx ON public.px_evaluations USING btree (cycle_id);


--
-- Name: px_evaluations_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX px_evaluations_external_idx ON public.px_evaluations USING btree (source, external_id);


--
-- Name: px_evaluations_operator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_evaluations_operator_idx ON public.px_evaluations USING btree (operator_id);


--
-- Name: px_evaluations_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_evaluations_product_idx ON public.px_evaluations USING btree (product, segment);


--
-- Name: px_feedbacks_eval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_feedbacks_eval_idx ON public.px_feedbacks USING btree (evaluation_id, applied_at DESC);


--
-- Name: px_items_eval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_items_eval_idx ON public.px_evaluation_items USING btree (evaluation_id);


--
-- Name: px_notifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_notifications_user_idx ON public.px_notifications USING btree (user_id, read);


--
-- Name: px_operators_login_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_operators_login_idx ON public.px_operators USING btree (lower(login));


--
-- Name: px_profiles_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX px_profiles_email_idx ON public.px_profiles USING btree (lower(email));


--
-- Name: px_roster_login_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_roster_login_idx ON public.px_roster USING btree (portfolio, login);


--
-- Name: px_roster_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX px_roster_name_idx ON public.px_roster USING btree (name_key);


--
-- Name: px_actions px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_actions FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_bugs px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_bugs FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_contests px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_contests FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_criteria px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_criteria FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_cycles px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_cycles FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_drop_reviews px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_drop_reviews FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_evaluation_items px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_evaluation_items FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_evaluations px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_evaluations FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_feedbacks px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_feedbacks FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_notifications px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_notifications FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_operators px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_operators FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_profiles px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_profiles FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_roster px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_roster FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_roster_leaders px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_roster_leaders FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_settings px_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER px_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.px_settings FOR EACH STATEMENT EXECUTE FUNCTION public.px_broadcast_change();


--
-- Name: px_actions px_actions_contest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_actions
    ADD CONSTRAINT px_actions_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES public.px_contests(id) ON DELETE SET NULL;


--
-- Name: px_actions px_actions_evaluation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_actions
    ADD CONSTRAINT px_actions_evaluation_id_fkey FOREIGN KEY (evaluation_id) REFERENCES public.px_evaluations(id) ON DELETE SET NULL;


--
-- Name: px_actions px_actions_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_actions
    ADD CONSTRAINT px_actions_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.px_feedbacks(id) ON DELETE SET NULL;


--
-- Name: px_actions px_actions_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_actions
    ADD CONSTRAINT px_actions_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.px_operators(id) ON DELETE SET NULL;


--
-- Name: px_actions px_actions_responsible_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_actions
    ADD CONSTRAINT px_actions_responsible_user_fkey FOREIGN KEY (responsible_user) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_audit_log px_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_audit_log
    ADD CONSTRAINT px_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_bugs px_bugs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_bugs
    ADD CONSTRAINT px_bugs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_contests px_contests_evaluation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_contests
    ADD CONSTRAINT px_contests_evaluation_id_fkey FOREIGN KEY (evaluation_id) REFERENCES public.px_evaluations(id) ON DELETE CASCADE;


--
-- Name: px_contests px_contests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_contests
    ADD CONSTRAINT px_contests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_contests px_contests_responded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_contests
    ADD CONSTRAINT px_contests_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_drop_reviews px_drop_reviews_analyst_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_drop_reviews
    ADD CONSTRAINT px_drop_reviews_analyst_id_fkey FOREIGN KEY (analyst_id) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_drop_reviews px_drop_reviews_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_drop_reviews
    ADD CONSTRAINT px_drop_reviews_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_drop_reviews px_drop_reviews_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_drop_reviews
    ADD CONSTRAINT px_drop_reviews_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_evaluation_items px_evaluation_items_adjusted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluation_items
    ADD CONSTRAINT px_evaluation_items_adjusted_by_fkey FOREIGN KEY (adjusted_by) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_evaluation_items px_evaluation_items_criterion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluation_items
    ADD CONSTRAINT px_evaluation_items_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES public.px_criteria(id) ON DELETE CASCADE;


--
-- Name: px_evaluation_items px_evaluation_items_evaluation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluation_items
    ADD CONSTRAINT px_evaluation_items_evaluation_id_fkey FOREIGN KEY (evaluation_id) REFERENCES public.px_evaluations(id) ON DELETE CASCADE;


--
-- Name: px_evaluations px_evaluations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluations
    ADD CONSTRAINT px_evaluations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_evaluations px_evaluations_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluations
    ADD CONSTRAINT px_evaluations_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.px_cycles(id) ON DELETE SET NULL;


--
-- Name: px_evaluations px_evaluations_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluations
    ADD CONSTRAINT px_evaluations_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.px_operators(id) ON DELETE CASCADE;


--
-- Name: px_evaluations px_evaluations_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_evaluations
    ADD CONSTRAINT px_evaluations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_feedbacks px_feedbacks_applied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_feedbacks
    ADD CONSTRAINT px_feedbacks_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_feedbacks px_feedbacks_evaluation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_feedbacks
    ADD CONSTRAINT px_feedbacks_evaluation_id_fkey FOREIGN KEY (evaluation_id) REFERENCES public.px_evaluations(id) ON DELETE CASCADE;


--
-- Name: px_feedbacks px_feedbacks_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_feedbacks
    ADD CONSTRAINT px_feedbacks_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.px_operators(id) ON DELETE CASCADE;


--
-- Name: px_notifications px_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_notifications
    ADD CONSTRAINT px_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.px_profiles(id) ON DELETE CASCADE;


--
-- Name: px_operators px_operators_supervisor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_operators
    ADD CONSTRAINT px_operators_supervisor_user_id_fkey FOREIGN KEY (supervisor_user_id) REFERENCES public.px_profiles(id) ON DELETE SET NULL;


--
-- Name: px_profiles px_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.px_profiles
    ADD CONSTRAINT px_profiles_id_fkey FOREIGN KEY (id) REFERENCES public.px_auth_users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



-- -------------------------------------------------------------------------------------
-- Dados padrão de uma instalação nova: critérios dos roteiros, quinzenas e configurações
-- -------------------------------------------------------------------------------------
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":1,"product":"AMBOS","code":"ABE","name":"Abordagem e saudação","description":"Cumprimentou, apresentou-se com nome e informou que fala da Paschoalotto em nome do credor.","weight":1,"critical":false,"sort":1,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":2,"product":"AMBOS","code":"IDT","name":"Identificação positiva (LGPD)","description":"Confirmou a titularidade (nome completo + dado de segurança) antes de expor qualquer informação do contrato.","weight":2,"critical":true,"sort":2,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":3,"product":"AMBOS","code":"MOT","name":"Motivo do contato","description":"Informou de forma clara o motivo da ligação e a situação do contrato.","weight":1,"critical":false,"sort":3,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":4,"product":"AMBOS","code":"SON","name":"Sondagem","description":"Investigou o motivo do atraso e a capacidade real de pagamento antes de ofertar.","weight":1.5,"critical":false,"sort":4,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":5,"product":"AMBOS","code":"EMP","name":"Empatia e escuta ativa","description":"Manteve tom cordial, não interrompeu, demonstrou compreensão da situação do cliente.","weight":1,"critical":false,"sort":5,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":6,"product":"AMBOS","code":"LIN","name":"Linguagem e clareza","description":"Linguagem adequada, sem jargões, gírias ou termos que gerem dúvida.","weight":0.5,"critical":false,"sort":6,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":7,"product":"AMBOS","code":"ETI","name":"Conduta ética (CDC art. 42)","description":"Não houve coação, ameaça, constrangimento ou informação enganosa.","weight":2,"critical":true,"sort":7,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":8,"product":"AMBOS","code":"ENC","name":"Encerramento","description":"Recapitulou o combinado, informou canais de atendimento e agradeceu.","weight":1,"critical":false,"sort":8,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":9,"product":"REFIN","code":"RPR","name":"Proposta de refinanciamento","description":"Apresentou a proposta: novo valor de parcela, quantidade de parcelas e data de vencimento.","weight":2,"critical":false,"sort":9,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":10,"product":"REFIN","code":"RCE","name":"Transparência das condições","description":"Informou taxa de juros, CET e valor total do novo contrato.","weight":2,"critical":true,"sort":10,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":11,"product":"REFIN","code":"RCO","name":"Negociação e contorno de objeções","description":"Tratou objeções com argumentos e alternativas, sem pressionar.","weight":1.5,"critical":false,"sort":11,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":12,"product":"REFIN","code":"RFO","name":"Formalização do aceite","description":"Obteve aceite explícito e informou como o cliente receberá contrato/boleto.","weight":1.5,"critical":false,"sort":12,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":13,"product":"REFIN","code":"RDA","name":"Atualização cadastral","description":"Confirmou ou atualizou telefone, e-mail e endereço.","weight":0.5,"critical":false,"sort":13,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":14,"product":"ENTREGA","code":"EAL","name":"Alternativas antes da entrega","description":"Ofereceu alternativas (acordo/refinanciamento) antes de seguir com a entrega amigável.","weight":1,"critical":false,"sort":14,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":15,"product":"ENTREGA","code":"EEX","name":"Explicação do processo","description":"Explicou o que é a entrega amigável, que é voluntária, e as etapas do processo.","weight":2,"critical":false,"sort":15,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":16,"product":"ENTREGA","code":"ESD","name":"Saldo residual e consequências","description":"Informou sobre venda do bem, possível saldo devedor remanescente e como será tratado.","weight":2,"critical":true,"sort":16,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":17,"product":"ENTREGA","code":"ELO","name":"Logística da entrega","description":"Orientou local, data/agendamento, documentos e chaves necessários.","weight":1.5,"critical":false,"sort":17,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":18,"product":"ENTREGA","code":"EVE","name":"Condições do veículo","description":"Orientou retirada de pertences, débitos de multas/IPVA e vistoria.","weight":1,"critical":false,"sort":18,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":19,"product":"ENTREGA","code":"EFO","name":"Formalização da entrega","description":"Confirmou o aceite e explicou a assinatura do termo de entrega.","weight":1.5,"critical":false,"sort":19,"active":true,"stage":null}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":20,"product":"SEM_GARANTIA","code":"BEN","name":"Citou benefício de pagar","description":"Exemplo: \\"Regularizando hoje, evita juros, interrompe as ligações e pode retirar o nome das restrições.\\" Cabe quando houve negociação.","weight":1,"critical":false,"sort":8,"active":true,"stage":"Argumentação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":21,"product":"VEICULOS","code":"ORF","name":"Ofertou o refinanciamento","description":"Só conta para cliente apto ao refin (não vale em ajuizados). Cliente que não consegue pagar as atrasadas: oferte o refin com entrada e parcela.","weight":1,"critical":false,"sort":9,"active":true,"stage":"E.A. e refin"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":22,"product":"SEM_GARANTIA","code":"CPF","name":"Confirmação positiva (CPF)","description":"Exemplo: \\"Para sua segurança, poderia me confirmar os três primeiros dígitos do seu CPF?\\" Cabe quando quem atendeu é o titular, antes de expor a dívida.","weight":1,"critical":false,"sort":2,"active":true,"stage":"Iniciação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":23,"product":"VEICULOS","code":"ALT","name":"Outra opção depois do \\"não\\"","description":"Depois do \\"não\\": outra data, uma parcela, quitação, refin ou entrega amigável.","weight":1,"critical":false,"sort":7,"active":true,"stage":"Negociação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":24,"product":"SEM_GARANTIA","code":"SQQ","name":"Perguntou quanto ou quando consegue","description":"Exemplo: \\"Qual valor o senhor dispõe hoje para negociarmos?\\" ou \\"até quando consegue?\\" Não cabe se o cliente já disse valor e data sozinho.","weight":1,"critical":false,"sort":5,"active":true,"stage":"Sondagem"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":25,"product":"VEICULOS","code":"POS","name":"Postura respeitosa","description":"Ouvir sem interromper, sem ironia e sem ameaça. Acompanhada à parte: não entra na nota.","weight":0,"critical":false,"sort":13,"active":true,"stage":"Postura"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":26,"product":"SEM_GARANTIA","code":"APR","name":"Apresentação e aviso de gravação","description":"Exemplo: \\"Meu nome é ..., falo da Paschoalotto, representante do Banco PAN. Informo que esta ligação está sendo gravada.\\" Cabe sempre que o operador falou com alguém.","weight":1,"critical":false,"sort":1,"active":true,"stage":"Iniciação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":27,"product":"VEICULOS","code":"PRP","name":"Fez proposta com valor","description":"Exemplo: \\"A parcela fica R$ 850,00 com vencimento amanhã.\\" Conta como feita quando houve acordo ou recusa de uma proposta.","weight":1,"critical":false,"sort":6,"active":true,"stage":"Negociação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":28,"product":"VEICULOS","code":"SMO","name":"Perguntou o motivo do atraso","description":"Exemplo: \\"O que aconteceu que impediu o pagamento?\\" Não conta com finalização de descarte.","weight":1,"critical":false,"sort":4,"active":true,"stage":"Sondagem"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":29,"product":"SEM_GARANTIA","code":"CFA","name":"Confirmou valor e data do acordo","description":"Exemplo: \\"O acordo foi formalizado no valor de R$ ..., com pagamento no dia ..., correto?\\" Cabe só quando houve acordo com boleto ou Pix.","weight":1,"critical":false,"sort":10,"active":true,"stage":"Fechamento"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":30,"product":"VEICULOS","code":"CSQ","name":"Explicou as consequências","description":"Exemplo: \\"Sem acordo, os juros continuam e o contrato pode ir para busca e apreensão.\\" Não conta quando houve acordo.","weight":1,"critical":false,"sort":11,"active":true,"stage":"Argumentação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":31,"product":"VEICULOS","code":"OEA","name":"Ofertou a entrega amigável","description":"Só conta para cliente apto à E.A. Cliente que não consegue manter o veículo: \\"o banco tem a entrega amigável, que quita a dívida\\".","weight":1,"critical":false,"sort":8,"active":true,"stage":"E.A. e refin"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":32,"product":"SEM_GARANTIA","code":"CAD","name":"Atualizou o cadastro","description":"Exemplo: \\"Seu telefone continua sendo ...? Seu e-mail permanece o mesmo?\\" Cabe quando houve acordo ou promessa e a ligação chegou ao fechamento.","weight":1,"critical":false,"sort":11,"active":true,"stage":"Fechamento"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":33,"product":"SEM_GARANTIA","code":"PRP","name":"Fez proposta com valor ou data","description":"Sempre apresentar uma proposta concreta (valor e data) antes de encerrar. Acompanhada no esforço negocial: não entra na nota de aderência.","weight":0,"critical":false,"sort":6,"active":true,"stage":"Negociação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":34,"product":"SEM_GARANTIA","code":"SMO","name":"Perguntou o motivo do atraso","description":"Exemplo: \\"Para melhor ajudá-lo, qual foi o motivo do atraso?\\" No consignado: férias, faltas, afastamento, contracheque. Não cabe quando o cliente contou o motivo sozinho ou a conversa não deu espaço.","weight":1,"critical":false,"sort":4,"active":true,"stage":"Sondagem"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":35,"product":"VEICULOS","code":"GRV","name":"Avisou que a ligação é gravada","description":"Exemplo: \\"Informo que esta ligação está sendo gravada.\\"","weight":1,"critical":false,"sort":3,"active":true,"stage":"Abertura"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":36,"product":"VEICULOS","code":"CFA","name":"Confirmou valor e data do acordo","description":"Exemplo: \\"O acordo ficou em R$ ..., com vencimento em ..., correto?\\"","weight":1,"critical":false,"sort":12,"active":true,"stage":"Fechamento"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":37,"product":"SEM_GARANTIA","code":"CSQ","name":"Explicou as consequências","description":"Exemplo: \\"Sem acordo, as ligações e os juros continuam e o nome permanece negativado.\\" Cabe só quando não houve acordo e havia negociação.","weight":1,"critical":false,"sort":9,"active":true,"stage":"Argumentação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":38,"product":"VEICULOS","code":"CTR","name":"Citou o contrato do veículo","description":"Exemplo: \\"É sobre o financiamento do seu [veículo] com o Banco PAN.\\"","weight":1,"critical":false,"sort":1,"active":true,"stage":"Abertura"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":39,"product":"VEICULOS","code":"BEN","name":"Citou benefício de pagar","description":"Exemplo: \\"Regularizando, para de correr juros e o nome sai da restrição.\\"","weight":1,"critical":false,"sort":10,"active":true,"stage":"Argumentação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":40,"product":"VEICULOS","code":"SQQ","name":"Perguntou quanto ou quando consegue","description":"Exemplo: \\"Até quando o senhor consegue? Qual valor cabe hoje?\\"","weight":1,"critical":false,"sort":5,"active":true,"stage":"Sondagem"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":41,"product":"SEM_GARANTIA","code":"ALT","name":"Outra opção depois do \\"não\\"","description":"Gradatividade: depois do \\"não\\", trazer outra condição (mínimo, intermediário, parcelamento, quitação, data mais próxima). Cabe só quando o cliente recusou a primeira proposta.","weight":1,"critical":false,"sort":7,"active":true,"stage":"Negociação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":42,"product":"SEM_GARANTIA","code":"DIV","name":"Dados da dívida e valor","description":"Exemplo: \\"O motivo do meu contato é o seu (produto), em atraso há X dias, hoje no valor de R$ ...\\" Cabe com o titular confirmado; não cabe se o cliente já chegou dizendo que pagou.","weight":1,"critical":false,"sort":3,"active":true,"stage":"Iniciação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":43,"product":"VEICULOS","code":"ATR","name":"Informou atraso ou valor","description":"Exemplo: \\"O contrato está com 3 parcelas em atraso, hoje no valor de R$ ...\\"","weight":1,"critical":false,"sort":2,"active":true,"stage":"Abertura"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":44,"product":"AGV","code":"CSQ","name":"Explicou as consequências","description":"SIM: explicou com calma juros que continuam, nome negativado, perda das condições, busca e apreensão ou cobrança judicial. Ameaça conta como não feito. N/A: houve acordo ou não houve negociação com o titular.","weight":1,"critical":false,"sort":8,"active":true,"stage":"Argumentação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":45,"product":"AGV","code":"SMO","name":"Perguntou o motivo do atraso","description":"SIM: abriu espaço para o cliente explicar (o que aconteceu, algum imprevisto, como está a situação). Perguntar só se já pagou não conta. N/A: sem negociação com o titular ou o cliente explicou sozinho.","weight":1,"critical":false,"sort":3,"active":true,"stage":"Sondagem"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":46,"product":"AGV","code":"PRP","name":"Ofereceu pagamento com valor","description":"SIM: ofereceu quitação, parcelas, entrada, parcelamento, refin ou acordo com valor em reais. Só informar o valor da dívida não conta. N/A: sem negociação com o titular.","weight":1,"critical":false,"sort":5,"active":true,"stage":"Negociação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":47,"product":"AGV","code":"ALT","name":"Outra condição depois do \\"não\\"","description":"SIM: após a recusa, ofereceu outro valor, uma parte, outra data, parcelamento, desconto, refin ou entrega amigável. N/A: sem negociação, sem proposta ou o cliente aceitou a primeira.","weight":1,"critical":false,"sort":6,"active":true,"stage":"Negociação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":48,"product":"AGV","code":"ATR","name":"Informou o que está em atraso","description":"SIM: citou o produto (financiamento, veículo, cartão ou fatura) e os dias, as parcelas ou o valor em atraso. N/A: o cliente disse que já pagou, interrompeu antes, ou a assistente virtual já informou a dívida.","weight":1,"critical":false,"sort":2,"active":true,"stage":"Abertura"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":49,"product":"AGV","code":"SQQ","name":"Perguntou quanto ou quando consegue","description":"SIM: perguntou uma data (quando recebe, melhor dia) ou um valor (quanto consegue, quanto de entrada). N/A: sem negociação ou o cliente aceitou a primeira proposta já dizendo valor e data.","weight":1,"critical":false,"sort":4,"active":true,"stage":"Sondagem"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":50,"product":"AGV","code":"BEN","name":"Citou benefício de pagar","description":"SIM: parar os juros, evitar encargos, limpar o nome, parar as ligações, ficar em dia ou desconto que vale hoje. N/A: sem negociação com o titular.","weight":1,"critical":false,"sort":7,"active":true,"stage":"Argumentação"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":51,"product":"AGV","code":"CFA","name":"Repetiu valor e data do acordo","description":"SIM: repetiu o valor e a data perto do fechamento. Só o valor ou só a data não conta. N/A: não houve acordo com boleto.","weight":1,"critical":false,"sort":9,"active":true,"stage":"Fechamento"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, '{"id":52,"product":"AGV","code":"APR","name":"Disse o nome e a empresa","description":"SIM: disse o próprio nome e a empresa (Paschoalotto ou Banco PAN). NÃO: faltou o nome ou a empresa.","weight":1,"critical":false,"sort":1,"active":true,"stage":"Abertura"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":53,"product":"AGV2","code":"APN","name":"Após o primeiro não","description":"Depois da recusa, trouxe outra opção em vez de encerrar. Não se aplica quando o cliente aceitou a primeira oferta. Exemplo: \\"Entendo. Então vamos ver outra forma: qual valor cabe até amanhã?\\"","weight":1,"critical":false,"sort":4,"active":true,"stage":"Esforço negocial"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":54,"product":"AGV2","code":"VDV","name":"Valor da dívida","description":"Informou o valor atualizado. Na quitação, mostrou o saldo junto com o valor com desconto. Exemplo: \\"Hoje o saldo está em R$ X. Para quitação, consigo liberar R$ Y.\\"","weight":1,"critical":false,"sort":2,"active":true,"stage":"Esforço negocial"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":55,"product":"AGV2","code":"OUV","name":"Ouviu antes de ofertar","description":"Perguntou o motivo ou deixou o cliente contar antes da oferta. Exemplo: \\"O que aconteceu para atrasar esse mês?\\"","weight":1,"critical":false,"sort":10,"active":true,"stage":"Roteiro AGV"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":56,"product":"AGV2","code":"CSQ","name":"Consequências","description":"Ao encerrar sem acordo, avisou com calma: juros e ligações continuam, nome negativado, risco de busca e apreensão. Exemplo: \\"Sem o pagamento, os juros continuam e o contrato pode ir para busca e apreensão.\\"","weight":1,"critical":false,"sort":5,"active":true,"stage":"Esforço negocial"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":57,"product":"AGV2","code":"EMP","name":"Cita a Paschoalotto","description":"Se apresentou como Paschoalotto, assessoria do Banco PAN. Exemplo: \\"Sou a Ana, da Paschoalotto, assessoria do Banco PAN.\\"","weight":1,"critical":false,"sort":7,"active":true,"stage":"Roteiro AGV"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":58,"product":"AGV2","code":"SND","name":"Sondagem","description":"Perguntou o motivo do atraso e quanto ou quando o cliente consegue pagar. Se o cliente contou sozinho e o operador ouviu, vale. Exemplo: \\"O que aconteceu para atrasar? E quanto o senhor consegue pagar até amanhã?\\"","weight":1,"critical":false,"sort":1,"active":true,"stage":"Esforço negocial"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":59,"product":"AGV2","code":"SRV","name":"Sem revalidar dados","description":"Não pediu de novo CPF ou data de nascimento: a AGV já validou. Exemplo: \\"Seu João, estou retornando sobre o contrato do seu veículo.\\"","weight":1,"critical":false,"sort":9,"active":true,"stage":"Roteiro AGV"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":60,"product":"AGV2","code":"SDS","name":"Saldo com saída","description":"Passou o valor já com uma saída: desconto, condição ou forma de pagamento. Exemplo: \\"Hoje está em R$ X, e consigo gerar só a parcela mais atrasada para amanhã.\\"","weight":1,"critical":false,"sort":11,"active":true,"stage":"Roteiro AGV"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":61,"product":"AGV2","code":"ESC","name":"Escada de ofertas","description":"Desceu a escada conforme o cliente: quitação, parcelas em atraso, parcela mais atrasada, uma parte até amanhã. Exemplo: \\"Se a quitação não cabe, consigo gerar só a parcela mais atrasada para amanhã.\\"","weight":1,"critical":false,"sort":3,"active":true,"stage":"Esforço negocial"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":62,"product":"AGV2","code":"NOM","name":"Nome do cliente","description":"Chamou o cliente pelo nome logo na abertura. Exemplo: \\"Bom dia, seu João!\\"","weight":1,"critical":false,"sort":6,"active":true,"stage":"Roteiro AGV"}') on conflict do nothing;
insert into public.px_criteria select * from json_populate_record(null::public.px_criteria, E'{"id":63,"product":"AGV2","code":"GRV","name":"Aviso de gravação","description":"Avisou que a ligação é gravada. Exemplo: \\"Essa ligação está sendo gravada, tá bom?\\"","weight":1,"critical":false,"sort":8,"active":true,"stage":"Roteiro AGV"}') on conflict do nothing;
insert into public.px_settings select * from json_populate_record(null::public.px_settings, '{"key":"ai_effort","value":"high"}') on conflict do nothing;
insert into public.px_settings select * from json_populate_record(null::public.px_settings, '{"key":"ai_model","value":"claude-opus-5-5"}') on conflict do nothing;
insert into public.px_settings select * from json_populate_record(null::public.px_settings, '{"key":"company_name","value":"Paschoalotto"}') on conflict do nothing;

select setval(pg_get_serial_sequence('public.px_criteria', 'id'), coalesce((select max(id) from public.px_criteria), 0) + 1, false);
select setval(pg_get_serial_sequence('public.px_cycles', 'id'), coalesce((select max(id) from public.px_cycles), 0) + 1, false);

-- Migrações já contidas neste arquivo (as próximas entram pelo aplicar-migracoes)
insert into public.px_schema_migrations (version) values ('20261024150000_px_monitorias') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261026120000_px_realtime_seed') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261026160000_px_carteiras_dashboards') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261027120000_px_contestacoes') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261028120000_px_acoes_planilha') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261029120000_px_agv') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261030120000_px_agv_esforco') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261031120000_px_agv_analise_diaria') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261101120000_px_quedas') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261102120000_px_quedas_carteiras') on conflict do nothing;
insert into public.px_schema_migrations (version) values ('20261103120000_px_quedas_export') on conflict do nothing;
