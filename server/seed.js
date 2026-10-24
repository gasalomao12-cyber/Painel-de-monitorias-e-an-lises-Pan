'use strict';
const { admin, must, fetchAll } = require('./supa');
const { getSetting, setSetting } = require('./db');
const { computeScore } = require('./scoring');
const { findAuthUserByEmail, validatePassword } = require('./auth');

const DEFAULT_CRITERIA = [
  // Comuns aos dois produtos
  ['AMBOS', 'ABE', 'Abordagem e saudação', 'Cumprimentou, apresentou-se com nome e informou que fala da Paschoalotto em nome do credor.', 1, 0],
  ['AMBOS', 'IDT', 'Identificação positiva (LGPD)', 'Confirmou a titularidade (nome completo + dado de segurança) antes de expor qualquer informação do contrato.', 2, 1],
  ['AMBOS', 'MOT', 'Motivo do contato', 'Informou de forma clara o motivo da ligação e a situação do contrato.', 1, 0],
  ['AMBOS', 'SON', 'Sondagem', 'Investigou o motivo do atraso e a capacidade real de pagamento antes de ofertar.', 1.5, 0],
  ['AMBOS', 'EMP', 'Empatia e escuta ativa', 'Manteve tom cordial, não interrompeu, demonstrou compreensão da situação do cliente.', 1, 0],
  ['AMBOS', 'LIN', 'Linguagem e clareza', 'Linguagem adequada, sem jargões, gírias ou termos que gerem dúvida.', 0.5, 0],
  ['AMBOS', 'ETI', 'Conduta ética (CDC art. 42)', 'Não houve coação, ameaça, constrangimento ou informação enganosa.', 2, 1],
  ['AMBOS', 'ENC', 'Encerramento', 'Recapitulou o combinado, informou canais de atendimento e agradeceu.', 1, 0],
  // Refinanciamento
  ['REFIN', 'RPR', 'Proposta de refinanciamento', 'Apresentou a proposta: novo valor de parcela, quantidade de parcelas e data de vencimento.', 2, 0],
  ['REFIN', 'RCE', 'Transparência das condições', 'Informou taxa de juros, CET e valor total do novo contrato.', 2, 1],
  ['REFIN', 'RCO', 'Negociação e contorno de objeções', 'Tratou objeções com argumentos e alternativas, sem pressionar.', 1.5, 0],
  ['REFIN', 'RFO', 'Formalização do aceite', 'Obteve aceite explícito e informou como o cliente receberá contrato/boleto.', 1.5, 0],
  ['REFIN', 'RDA', 'Atualização cadastral', 'Confirmou ou atualizou telefone, e-mail e endereço.', 0.5, 0],
  // Entrega amigável
  ['ENTREGA', 'EAL', 'Alternativas antes da entrega', 'Ofereceu alternativas (acordo/refinanciamento) antes de seguir com a entrega amigável.', 1, 0],
  ['ENTREGA', 'EEX', 'Explicação do processo', 'Explicou o que é a entrega amigável, que é voluntária, e as etapas do processo.', 2, 0],
  ['ENTREGA', 'ESD', 'Saldo residual e consequências', 'Informou sobre venda do bem, possível saldo devedor remanescente e como será tratado.', 2, 1],
  ['ENTREGA', 'ELO', 'Logística da entrega', 'Orientou local, data/agendamento, documentos e chaves necessários.', 1.5, 0],
  ['ENTREGA', 'EVE', 'Condições do veículo', 'Orientou retirada de pertences, débitos de multas/IPVA e vistoria.', 1, 0],
  ['ENTREGA', 'EFO', 'Formalização da entrega', 'Confirmou o aceite e explicou a assinatura do termo de entrega.', 1.5, 0],
];


async function seedBase() {
  const sb = admin();
  const hasCriteria = await must(sb.from('px_criteria').select('id').limit(1));
  if (!hasCriteria.length) {
    await must(sb.from('px_criteria').insert(DEFAULT_CRITERIA.map((c, i) => ({
      product: c[0], code: c[1], name: c[2], description: c[3], weight: c[4], critical: !!c[5], sort: i + 1,
    }))));
  }
  await ensureAdmin();
  if (getSetting('company_name') == null) await setSetting('company_name', 'Paschoalotto');
  if (getSetting('ai_model') == null) await setSetting('ai_model', 'claude-opus-5-5');
  if (getSetting('ai_effort') == null) await setSetting('ai_effort', 'high');
}

// Garante o primeiro administrador a partir de ADMIN_EMAIL / ADMIN_PASSWORD
async function ensureAdmin() {
  const sb = admin();
  const admins = await must(sb.from('px_profiles').select('id').eq('role', 'admin').limit(1));
  if (admins.length) return;
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) {
    console.warn('\n  ⚠ Nenhum administrador cadastrado. Defina ADMIN_EMAIL (e ADMIN_PASSWORD) e reinicie o servidor.\n');
    return;
  }
  let user = await findAuthUserByEmail(email);
  let mustChange = false;
  if (!user) {
    const password = process.env.ADMIN_PASSWORD;
    const err = validatePassword(password);
    if (err) { console.warn(`\n  ⚠ ADMIN_PASSWORD inválida para criar o administrador: ${err}\n`); return; }
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: 'Administrador' } });
    if (error) throw error;
    user = data.user;
    mustChange = true;
    console.log(`\n  ▸ Administrador criado no Supabase Auth: ${email} (troca de senha obrigatória no 1º acesso).\n`);
  } else {
    console.log(`\n  ▸ Administrador vinculado a um usuário já existente no Supabase Auth: ${email} (use a senha atual dele).\n`);
  }
  await must(sb.from('px_profiles').upsert({ id: user.id, email, name: user.user_metadata?.name || 'Administrador', role: 'admin', must_change_password: mustChange }));
}

function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const DEMO_OPERATORS = [
  ['Ana Beatriz Moreira', 'Equipe Alfa'], ['Bruno Henrique Lima', 'Equipe Alfa'], ['Camila Rocha Souza', 'Equipe Alfa'],
  ['Diego Fernandes', 'Equipe Alfa'], ['Elaine Cristina Prado', 'Equipe Alfa'], ['Felipe Augusto Nunes', 'Equipe Alfa'],
  ['Gabriela Martins', 'Equipe Alfa'], ['Henrique Duarte', 'Equipe Beta'], ['Isabela Teixeira', 'Equipe Beta'],
  ['João Pedro Ramos', 'Equipe Beta'], ['Karina Albuquerque', 'Equipe Beta'], ['Lucas Vieira Campos', 'Equipe Beta'],
  ['Mariana Lopes', 'Equipe Beta'], ['Rafael Cardoso', 'Equipe Beta'],
];

const DEMO_CYCLES = [
  ['1ª Quinzena · Jul/2026', '2026-07-01', '2026-07-15', 'encerrado'],
  ['2ª Quinzena · Jul/2026', '2026-07-16', '2026-07-31', 'encerrado'],
  ['1ª Quinzena · Ago/2026', '2026-08-01', '2026-08-15', 'encerrado'],
  ['2ª Quinzena · Ago/2026', '2026-08-16', '2026-08-31', 'encerrado'],
  ['1ª Quinzena · Set/2026', '2026-09-01', '2026-09-15', 'publicado'],
  ['2ª Quinzena · Set/2026', '2026-09-16', '2026-09-30', 'publicado'],
  ['1ª Quinzena · Out/2026', '2026-10-01', '2026-10-15', 'aberto'],
];

const SAMPLE_TRANSCRIPT_REFIN = `[00:00] Operador: Bom dia, meu nome é {OP}, falo da Paschoalotto em nome do Banco. Por gentileza, falo com o senhor Carlos Eduardo Silva?
[00:06] Cliente: Sim, é ele.
[00:08] Operador: Senhor Carlos, para sua segurança, pode me confirmar os três primeiros dígitos do seu CPF e sua data de nascimento?
[00:14] Cliente: 123, nasci em 12 de março de 1985.
[00:19] Operador: Obrigado, confirmado. O motivo do meu contato é o seu contrato de financiamento do veículo, que está com duas parcelas em atraso. Aconteceu alguma coisa para o senhor não conseguir pagar?
[00:30] Cliente: Fiquei desempregado em julho, agora voltei a trabalhar, mas o salário é menor.
[00:36] Operador: Entendo, sinto muito pela situação. Hoje, quanto o senhor conseguiria pagar por mês sem apertar o orçamento?
[00:42] Cliente: Uns setecentos reais, no máximo.
[00:46] Operador: Certo. Consigo uma proposta de refinanciamento: as parcelas em atraso entram no saldo e a nova parcela fica em R$ 689,90, em 36 vezes, com primeiro vencimento dia 10 de novembro.
[01:02] Cliente: E os juros, como ficam?
[01:05] Operador: A taxa fica em 1,89% ao mês, e o custo efetivo total é de 2,15% ao mês. O valor total do novo contrato fica em R$ 24.836,40.
[01:18] Cliente: Hum, é um pouco alto, mas cabe no bolso.
[01:22] Operador: O senhor fica à vontade. Se preferir, consigo também em 30 vezes de R$ 790. Qual faz mais sentido?
[01:30] Cliente: Prefiro a de 36.
[01:33] Operador: Perfeito. Então confirmo: o senhor aceita o refinanciamento em 36 parcelas de R$ 689,90, vencimento dia 10?
[01:40] Cliente: Aceito, sim.
[01:42] Operador: Ótimo. O contrato e o boleto chegam no seu e-mail e por SMS. Seu e-mail ainda é carlos.silva@email.com?
[01:50] Cliente: Esse mesmo.
[01:52] Operador: Combinado então, senhor Carlos: refinanciamento em 36 vezes de R$ 689,90, primeiro vencimento dia 10 de novembro. Qualquer dúvida, nosso WhatsApp e a central estão no boleto. Agradeço a atenção e tenha um ótimo dia.
[02:05] Cliente: Obrigado, bom dia.`;

const SAMPLE_TRANSCRIPT_ENTREGA = `[00:00] Operador: Boa tarde, aqui é {OP}, da Paschoalotto, em nome do Banco. Falo com a senhora Patrícia Gomes?
[00:05] Cliente: Sou eu.
[00:07] Operador: Senhora Patrícia, para confirmar a sua identidade, qual é a sua data de nascimento?
[00:11] Cliente: 4 de agosto de 1979.
[00:14] Operador: Obrigado. Estou ligando sobre o contrato do seu veículo, que está com quatro parcelas em aberto. A senhora tinha comentado no último contato que pensava em devolver o carro, certo?
[00:24] Cliente: Isso. Não tenho mais condição de pagar.
[00:27] Operador: Entendo. Antes, só para a senhora saber, temos opção de refinanciar com parcela menor. Quer que eu simule?
[00:33] Cliente: Não, já decidi. Quero entregar.
[00:36] Operador: Tudo bem. A entrega amigável é voluntária: a senhora leva o veículo até o pátio credenciado, assina o termo de entrega e o banco faz a venda do bem.
[00:48] Cliente: E aí a dívida acaba?
[00:50] Operador: Aí fica tudo resolvido, a senhora não precisa se preocupar com mais nada.
[00:55] Cliente: Ah, que bom.
[00:57] Operador: O pátio fica na Avenida das Indústrias, 1500. Posso agendar para quinta-feira às 10h? A senhora leva o documento do carro, as duas chaves e um documento com foto.
[01:08] Cliente: Pode ser.
[01:10] Operador: Lembre de retirar seus pertences do carro. Ficou agendado quinta às 10h. Obrigado e boa tarde.`;


const DEMO_DOMAIN = 'px-demo.local';

async function demoUser(username, name, role) {
  const sb = admin();
  const email = `${username}@${DEMO_DOMAIN}`;
  let user = await findAuthUserByEmail(email);
  if (!user) {
    const { data, error } = await sb.auth.admin.createUser({ email, password: 'Px@2026demo', email_confirm: true, user_metadata: { name } });
    if (error) throw error;
    user = data.user;
  }
  await must(sb.from('px_profiles').upsert({ id: user.id, email, name, role, must_change_password: true }));
  return user.id;
}

async function seedDemo() {
  if (getSetting('demo_seeded') === '1') return;
  const sb = admin();
  if ((await must(sb.from('px_evaluations').select('id').limit(1))).length) { await setSetting('demo_seeded', '1'); return; }

  const rnd = prng(20261024);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ids = {
    qualidade: await demoUser('qualidade', 'Analista de Qualidade', 'qualidade'),
    'supervisor.alfa': await demoUser('supervisor.alfa', 'Supervisor Equipe Alfa', 'supervisor'),
    'supervisor.beta': await demoUser('supervisor.beta', 'Supervisora Equipe Beta', 'supervisor'),
  };
  const qualityId = ids.qualidade;

  const ops = await must(sb.from('px_operators').insert(DEMO_OPERATORS.map(([name, team], i) => ({
    name, team, registration: `PX${String(1040 + i * 7).padStart(5, '0')}`, is_demo: true,
    supervisor_user_id: team === 'Equipe Alfa' ? ids['supervisor.alfa'] : ids['supervisor.beta'],
    supervisor_name: team === 'Equipe Alfa' ? 'Supervisor Equipe Alfa' : 'Supervisora Equipe Beta',
  }))).select('id, registration'));
  const opIds = DEMO_OPERATORS.map((_, i) => ops.find((o) => o.registration === `PX${String(1040 + i * 7).padStart(5, '0')}`).id);
  const skill = opIds.map(() => 0.58 + rnd() * 0.38);
  const growth = opIds.map(() => (rnd() - 0.3) * 0.035);

  const criteria = await must(sb.from('px_criteria').select('*').eq('active', true).order('sort'));
  const crit = (p) => criteria.filter((c) => c.product === 'AMBOS' || c.product === p);

  const cycles = await must(sb.from('px_cycles').insert(DEMO_CYCLES.map(([name, s, e, st]) => ({
    name, start_date: s, end_date: e, status: st, is_demo: true,
    audio_folder_url: 'https://onedrive.live.com/?id=EXEMPLO-' + s.replace(/-/g, ''),
    published_at: st !== 'aberto' ? `${e}T18:00:00-03:00` : null,
  }))).select('id, start_date'));
  const cycleIds = DEMO_CYCLES.map(([, s]) => cycles.find((c) => c.start_date === s).id);

  const firstNames = ['Carlos', 'Patrícia', 'Roberto', 'Juliana', 'Marcos', 'Fernanda', 'Paulo', 'Luciana', 'André', 'Tatiane', 'Sérgio', 'Vanessa'];
  const lastNames = ['Silva', 'Gomes', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Almeida', 'Ribeiro', 'Carvalho', 'Barbosa'];
  const speechMisreads = [
    'Speech não reconheceu a confirmação de CPF (áudio com ruído).',
    'Termo "custo efetivo" transcrito como "custo e feito".',
    'Speech interpretou pausa como ausência de encerramento.',
    'Fala do cliente atribuída ao operador na transcrição.',
  ];

  const plans = [];
  DEMO_CYCLES.forEach(([, start], ci) => {
    const closed = DEMO_CYCLES[ci][3] !== 'aberto';
    opIds.forEach((opId, oi) => {
      const n = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < n; k++) {
        const product = rnd() < 0.62 ? 'REFIN' : 'ENTREGA';
        const day = 1 + Math.floor(rnd() * 14);
        const callDate = start.slice(0, 8) + String(Number(start.slice(8)) + day - 1).padStart(2, '0');
        const p = Math.min(0.99, skill[oi] + growth[oi] * ci + (product === 'ENTREGA' ? -0.05 : 0));
        const items = crit(product).map((c) => {
          const x = rnd();
          let r = x < p ? 'C' : x < p + (1 - p) * 0.45 ? 'P' : 'NC';
          if (c.critical && r === 'NC' && rnd() < 0.7) r = 'P';
          if (c.code === 'RDA' && rnd() < 0.15) r = 'NA';
          return { c, speech: r };
        });
        const misread = rnd() < 0.3;
        const misreadIdx = misread ? Math.floor(rnd() * items.length) : -1;
        if (misread && items[misreadIdx].speech === 'C') items[misreadIdx].speech = 'NC';
        const speechScore = computeScore(items.map((i) => ({ ...i.c, speech_result: i.speech })), 'speech_result').score;
        const reviewed = closed ? rnd() < 0.9 : rnd() < 0.35;
        const finalItems = items.map((it, idx) => {
          let fin = it.speech, adjusted = false, reason = null;
          if (reviewed && idx === misreadIdx) { fin = 'C'; adjusted = true; reason = pick(speechMisreads); }
          return { ...it, fin, adjusted, reason };
        });
        const finalScore = reviewed ? computeScore(finalItems.map((i) => ({ ...i.c, final_result: i.fin })), 'final_result').score : speechScore;
        const fbApplied = reviewed && (closed ? rnd() < 0.85 : rnd() < 0.3);
        const hasTranscript = ci >= 5 && rnd() < 0.4;
        const opName = DEMO_OPERATORS[oi][0].split(' ')[0];
        const protocol = `${callDate.replace(/-/g, '')}${String(Math.floor(rnd() * 1e6)).padStart(6, '0')}${plans.length}`;
        const at = `${callDate}T17:30:00-03:00`;
        plans.push({
          row: {
            cycle_id: cycleIds[ci], operator_id: opId, product, call_date: callDate, protocol,
            contract: `***${String(Math.floor(rnd() * 1e5)).padStart(5, '0')}`, customer: `${pick(firstNames)} ${pick(lastNames)}`,
            duration_sec: 90 + Math.floor(rnd() * 600), speech_score: speechScore, final_score: finalScore,
            speech_summary: product === 'REFIN' ? 'Contato de refinanciamento com proposta apresentada.' : 'Contato de entrega amigável do veículo.',
            status: fbApplied ? 'feedback_aplicado' : reviewed ? 'revisada' : 'pendente',
            transcript: hasTranscript ? (product === 'REFIN' ? SAMPLE_TRANSCRIPT_REFIN : SAMPLE_TRANSCRIPT_ENTREGA).replace(/\{OP\}/g, opName) : null,
            transcript_name: hasTranscript ? 'transcricao.txt' : null,
            reviewed_by: reviewed ? qualityId : null, reviewed_at: reviewed ? at : null, is_demo: true, created_by: qualityId,
          },
          items: finalItems.map((it) => ({
            criterion_id: it.c.id, speech_result: it.speech, speech_note: it.speech === 'C' ? null : 'Ponto identificado pelo speech analytics.',
            final_result: it.fin, adjusted: it.adjusted, adjust_reason: it.reason, adjust_source: it.adjusted ? 'manual' : null,
            adjusted_by: it.adjusted ? qualityId : null, adjusted_at: it.adjusted ? at : null,
          })),
          feedback: fbApplied ? (() => {
            const weak = finalItems.filter((i) => i.fin !== 'C' && i.fin !== 'NA').map((i) => i.c.name);
            const strong = finalItems.filter((i) => i.fin === 'C').slice(0, 3).map((i) => i.c.name);
            const sup = DEMO_OPERATORS[oi][1] === 'Equipe Alfa' ? ids['supervisor.alfa'] : ids['supervisor.beta'];
            return {
              operator_id: opId, applied_by: rnd() < 0.5 ? qualityId : sup, applied_at: `${callDate}T18:10:00-03:00`,
              modality: rnd() < 0.7 ? 'Presencial' : 'Remoto (Teams)',
              content: weak.length ? `Alinhado com o operador os pontos de melhoria: ${weak.join(', ')}. Reforçado o roteiro e ouvido trecho da ligação junto com ele.` : 'Feedback positivo: atendimento aderente ao roteiro. Operador reconhecido pela qualidade.',
              strengths: strong.join(', '), improvements: weak.join(', ') || null,
              action_plan: weak.length ? 'Nova monitoria na próxima quinzena com foco nos pontos alinhados.' : null, operator_ack: true,
            };
          })() : null,
        });
      }
    });
  });

  for (let i = 0; i < plans.length; i += 100) {
    const batch = plans.slice(i, i + 100);
    const rows = await must(sb.from('px_evaluations').insert(batch.map((b) => b.row)).select('id, protocol'));
    const idBy = new Map(rows.map((r) => [r.protocol, r.id]));
    await must(sb.from('px_evaluation_items').insert(batch.flatMap((b) => b.items.map((it) => ({ ...it, evaluation_id: idBy.get(b.row.protocol) })))));
    const fbs = batch.filter((b) => b.feedback).map((b) => ({ ...b.feedback, evaluation_id: idBy.get(b.row.protocol) }));
    if (fbs.length) await must(sb.from('px_feedbacks').insert(fbs));
  }
  await setSetting('demo_seeded', '1');
  console.log(`  ▸ Dados de demonstração carregados (${plans.length} monitorias; usuários *@${DEMO_DOMAIN}, senha Px@2026demo).`);
}

async function clearDemo() {
  const sb = admin();
  await must(sb.from('px_evaluations').delete().eq('is_demo', true));
  const used = new Set((await fetchAll(() => sb.from('px_evaluations').select('operator_id, cycle_id').order('id'))).flatMap((e) => [`o${e.operator_id}`, `c${e.cycle_id}`]));
  const demoOps = await must(sb.from('px_operators').select('id').eq('is_demo', true));
  const delOps = demoOps.filter((o) => !used.has(`o${o.id}`)).map((o) => o.id);
  if (delOps.length) await must(sb.from('px_operators').delete().in('id', delOps));
  const demoCycles = await must(sb.from('px_cycles').select('id').eq('is_demo', true));
  const delCycles = demoCycles.filter((c) => !used.has(`c${c.id}`)).map((c) => c.id);
  if (delCycles.length) await must(sb.from('px_cycles').delete().in('id', delCycles));
  const demoUsers = await must(sb.from('px_profiles').select('id, last_login').like('email', `%@${DEMO_DOMAIN}`));
  for (const u of demoUsers.filter((x) => !x.last_login)) {
    await must(sb.from('px_profiles').delete().eq('id', u.id));
    await sb.auth.admin.deleteUser(u.id);
  }
}

module.exports = { seedBase, seedDemo, clearDemo, SAMPLE_TRANSCRIPT_REFIN, SAMPLE_TRANSCRIPT_ENTREGA, DEFAULT_CRITERIA };
