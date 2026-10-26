-- PX Monitorias & Feedbacks — tempo real, dados padrão e primeiro administrador.
-- Pode ser executado mais de uma vez.

-- ---------------------------------------------------------------- Critérios padrão
insert into public.px_criteria (product, code, name, description, weight, critical, sort)
select v.product, v.code, v.name, v.description, v.weight, v.critical, v.sort
from (values
  ('AMBOS', 'ABE', 'Abordagem e saudação', 'Cumprimentou, apresentou-se com nome e informou que fala da Paschoalotto em nome do credor.', 1, false, 1),
  ('AMBOS', 'IDT', 'Identificação positiva (LGPD)', 'Confirmou a titularidade (nome completo + dado de segurança) antes de expor qualquer informação do contrato.', 2, true, 2),
  ('AMBOS', 'MOT', 'Motivo do contato', 'Informou de forma clara o motivo da ligação e a situação do contrato.', 1, false, 3),
  ('AMBOS', 'SON', 'Sondagem', 'Investigou o motivo do atraso e a capacidade real de pagamento antes de ofertar.', 1.5, false, 4),
  ('AMBOS', 'EMP', 'Empatia e escuta ativa', 'Manteve tom cordial, não interrompeu, demonstrou compreensão da situação do cliente.', 1, false, 5),
  ('AMBOS', 'LIN', 'Linguagem e clareza', 'Linguagem adequada, sem jargões, gírias ou termos que gerem dúvida.', 0.5, false, 6),
  ('AMBOS', 'ETI', 'Conduta ética (CDC art. 42)', 'Não houve coação, ameaça, constrangimento ou informação enganosa.', 2, true, 7),
  ('AMBOS', 'ENC', 'Encerramento', 'Recapitulou o combinado, informou canais de atendimento e agradeceu.', 1, false, 8),
  ('REFIN', 'RPR', 'Proposta de refinanciamento', 'Apresentou a proposta: novo valor de parcela, quantidade de parcelas e data de vencimento.', 2, false, 9),
  ('REFIN', 'RCE', 'Transparência das condições', 'Informou taxa de juros, CET e valor total do novo contrato.', 2, true, 10),
  ('REFIN', 'RCO', 'Negociação e contorno de objeções', 'Tratou objeções com argumentos e alternativas, sem pressionar.', 1.5, false, 11),
  ('REFIN', 'RFO', 'Formalização do aceite', 'Obteve aceite explícito e informou como o cliente receberá contrato/boleto.', 1.5, false, 12),
  ('REFIN', 'RDA', 'Atualização cadastral', 'Confirmou ou atualizou telefone, e-mail e endereço.', 0.5, false, 13),
  ('ENTREGA', 'EAL', 'Alternativas antes da entrega', 'Ofereceu alternativas (acordo/refinanciamento) antes de seguir com a entrega amigável.', 1, false, 14),
  ('ENTREGA', 'EEX', 'Explicação do processo', 'Explicou o que é a entrega amigável, que é voluntária, e as etapas do processo.', 2, false, 15),
  ('ENTREGA', 'ESD', 'Saldo residual e consequências', 'Informou sobre venda do bem, possível saldo devedor remanescente e como será tratado.', 2, true, 16),
  ('ENTREGA', 'ELO', 'Logística da entrega', 'Orientou local, data/agendamento, documentos e chaves necessários.', 1.5, false, 17),
  ('ENTREGA', 'EVE', 'Condições do veículo', 'Orientou retirada de pertences, débitos de multas/IPVA e vistoria.', 1, false, 18),
  ('ENTREGA', 'EFO', 'Formalização da entrega', 'Confirmou o aceite e explicou a assinatura do termo de entrega.', 1.5, false, 19)
) as v(product, code, name, description, weight, critical, sort)
where not exists (select 1 from public.px_criteria);

insert into public.px_settings (key, value) values
  ('company_name', 'Paschoalotto'), ('ai_model', 'claude-opus-5-5'), ('ai_effort', 'high')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- Primeiro administrador
-- Uso (SQL Editor), depois de criar o usuário em Authentication › Users:
--   select public.px_bootstrap_admin('seu.email@paschoalotto.com.br', 'Seu Nome');
create or replace function public.px_bootstrap_admin(p_email text, p_name text default 'Administrador')
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return 'Usuário não encontrado. Crie primeiro em Authentication › Users › Add user (com "Auto Confirm User").';
  end if;
  insert into public.px_profiles (id, email, name, role, must_change_password, active)
  values (uid, lower(trim(p_email)), coalesce(nullif(trim(p_name), ''), 'Administrador'), 'admin', false, true)
  on conflict (id) do update set role = 'admin', active = true;
  return 'Pronto: ' || lower(trim(p_email)) || ' agora é administrador da PX Monitorias.';
end $$;
revoke all on function public.px_bootstrap_admin(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Tempo real
-- Cada alteração nas tabelas da plataforma dispara um aviso leve no canal "px-updates"
-- (só o nome da tabela e a operação — nenhum dado). As telas abertas recarregam o que
-- estiverem mostrando, buscando os dados pela API com a permissão de cada usuário.
create or replace function public.px_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'op', tg_op, 'at', now()),
      'change', 'px-updates', false
    );
  exception when others then
    null; -- o aviso nunca pode impedir a gravação
  end;
  return null;
end $$;
revoke all on function public.px_broadcast_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['px_evaluations','px_evaluation_items','px_feedbacks','px_cycles','px_operators',
                           'px_criteria','px_bugs','px_notifications','px_profiles','px_settings'] loop
    execute format('drop trigger if exists px_broadcast on public.%I', t);
    execute format('create trigger px_broadcast after insert or update or delete on public.%I
                    for each statement execute function public.px_broadcast_change()', t);
  end loop;
end $$;
