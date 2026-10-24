'use strict';
const { all, get, run, tx, getSetting, setSetting } = require('./db');
const { hashPassword } = require('./auth');
const { computeScore } = require('./scoring');

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

function seedBase() {
  if (!get('SELECT id FROM criteria LIMIT 1')) {
    DEFAULT_CRITERIA.forEach((c, i) => run(
      'INSERT INTO criteria (product, code, name, description, weight, critical, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
      c[0], c[1], c[2], c[3], c[4], c[5], i + 1));
  }
  if (!get('SELECT id FROM users LIMIT 1')) {
    const pw = process.env.ADMIN_PASSWORD || 'Px@2026admin';
    run(`INSERT INTO users (username, name, role, password_hash, must_change_password) VALUES (?, ?, 'admin', ?, 1)`,
      process.env.ADMIN_USER || 'admin', 'Administrador', hashPassword(pw));
    console.log(`\n  ▸ Usuário administrador criado: ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASSWORD ? '(senha de ADMIN_PASSWORD)' : pw}`);
    console.log('    A troca de senha é obrigatória no primeiro acesso.\n');
  }
  if (getSetting('company_name') == null) setSetting('company_name', 'Paschoalotto');
  if (getSetting('ai_model') == null) setSetting('ai_model', 'claude-opus-5-5');
  if (getSetting('ai_effort') == null) setSetting('ai_effort', 'high');
}

// ---------- Dados de demonstração ----------
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

function seedDemo() {
  if (getSetting('demo_seeded') === '1') return;
  if (get('SELECT id FROM evaluations LIMIT 1')) { setSetting('demo_seeded', '1'); return; }

  const rnd = prng(20261024);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  tx(() => {
    // usuários de demonstração
    const demoUsers = [
      ['qualidade', 'Analista de Qualidade', 'qualidade'],
      ['supervisor.alfa', 'Supervisor Equipe Alfa', 'supervisor'],
      ['supervisor.beta', 'Supervisora Equipe Beta', 'supervisor'],
    ];
    const ids = {};
    for (const [u, n, r] of demoUsers) {
      if (!get('SELECT id FROM users WHERE username = ?', u)) {
        const info = run(`INSERT INTO users (username, name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)`, u, n, r, hashPassword('Px@2026demo'));
        ids[u] = Number(info.lastInsertRowid);
      } else ids[u] = get('SELECT id FROM users WHERE username = ?', u).id;
    }
    const qualityId = ids.qualidade;

    const opIds = DEMO_OPERATORS.map(([name, team], i) => {
      const sup = team === 'Equipe Alfa' ? ids['supervisor.alfa'] : ids['supervisor.beta'];
      const supName = team === 'Equipe Alfa' ? 'Supervisor Equipe Alfa' : 'Supervisora Equipe Beta';
      const info = run('INSERT INTO operators (name, registration, team, supervisor_user_id, supervisor_name) VALUES (?, ?, ?, ?, ?)',
        name, `PX${String(1040 + i * 7).padStart(5, '0')}`, team, sup, supName);
      return Number(info.lastInsertRowid);
    });
    // perfil de habilidade por operador (0.55 a 0.97)
    const skill = opIds.map(() => 0.58 + rnd() * 0.38);
    const growth = opIds.map(() => (rnd() - 0.3) * 0.035);

    const criteria = all('SELECT * FROM criteria WHERE active = 1 ORDER BY sort');
    const crit = (p) => criteria.filter((c) => c.product === 'AMBOS' || c.product === p);

    const cycleIds = DEMO_CYCLES.map(([name, s, e, st]) => Number(run(
      'INSERT INTO cycles (name, start_date, end_date, status, audio_folder_url, published_at) VALUES (?, ?, ?, ?, ?, ?)',
      name, s, e, st, 'https://onedrive.live.com/?id=EXEMPLO-' + s.replace(/-/g, ''), st !== 'aberto' ? e + ' 18:00:00' : null).lastInsertRowid));

    const firstNames = ['Carlos', 'Patrícia', 'Roberto', 'Juliana', 'Marcos', 'Fernanda', 'Paulo', 'Luciana', 'André', 'Tatiane', 'Sérgio', 'Vanessa'];
    const lastNames = ['Silva', 'Gomes', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Almeida', 'Ribeiro', 'Carvalho', 'Barbosa'];
    const speechMisreads = [
      'Speech não reconheceu a confirmação de CPF (áudio com ruído).',
      'Termo "custo efetivo" transcrito como "custo e feito".',
      'Speech interpretou pausa como ausência de encerramento.',
      'Fala do cliente atribuída ao operador na transcrição.',
    ];

    DEMO_CYCLES.forEach(([, start], ci) => {
      const cycleId = cycleIds[ci];
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
          // simula leituras equivocadas do speech em ~30% das monitorias
          const misread = rnd() < 0.3;
          const misreadIdx = misread ? Math.floor(rnd() * items.length) : -1;
          if (misread && items[misreadIdx].speech === 'C') items[misreadIdx].speech = 'NC';

          const speechScore = computeScore(items.map((i) => ({ ...i.c, speech_result: i.speech })), 'speech_result').score;
          const reviewed = closed ? rnd() < 0.9 : rnd() < 0.35;
          const finalItems = items.map((it, idx) => {
            let fin = it.speech, adjusted = 0, reason = null;
            if (reviewed && idx === misreadIdx) { fin = 'C'; adjusted = 1; reason = pick(speechMisreads); }
            return { ...it, fin, adjusted, reason };
          });
          const finalScore = reviewed
            ? computeScore(finalItems.map((i) => ({ ...i.c, final_result: i.fin })), 'final_result').score
            : speechScore;
          const fbApplied = reviewed && (closed ? rnd() < 0.85 : rnd() < 0.3);
          const customer = `${pick(firstNames)} ${pick(lastNames)}`;
          const hasTranscript = ci >= 5 && rnd() < 0.4;
          const opName = DEMO_OPERATORS[oi][0].split(' ')[0];
          const evalInfo = run(`INSERT INTO evaluations (cycle_id, operator_id, product, call_date, protocol, contract, customer, duration_sec,
            speech_score, final_score, speech_summary, status, transcript, transcript_name, reviewed_by, reviewed_at, is_demo, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          cycleId, opId, product, callDate,
          `${callDate.replace(/-/g, '')}${String(Math.floor(rnd() * 1e6)).padStart(6, '0')}`,
          `***${String(Math.floor(rnd() * 1e5)).padStart(5, '0')}`, customer, 90 + Math.floor(rnd() * 600),
          speechScore, finalScore,
          product === 'REFIN' ? 'Contato de refinanciamento com proposta apresentada.' : 'Contato de entrega amigável do veículo.',
          fbApplied ? 'feedback_aplicado' : reviewed ? 'revisada' : 'pendente',
          hasTranscript ? (product === 'REFIN' ? SAMPLE_TRANSCRIPT_REFIN : SAMPLE_TRANSCRIPT_ENTREGA).replace(/\{OP\}/g, opName) : null,
          hasTranscript ? 'transcricao.txt' : null,
          reviewed ? qualityId : null, reviewed ? callDate + ' 17:30:00' : null, qualityId);
          const evalId = Number(evalInfo.lastInsertRowid);
          for (const it of finalItems) {
            run(`INSERT INTO evaluation_items (evaluation_id, criterion_id, speech_result, speech_note, final_result, adjusted, adjust_reason, adjust_source, adjusted_by, adjusted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            evalId, it.c.id, it.speech, it.speech === 'C' ? null : 'Ponto identificado pelo speech analytics.',
            it.fin, it.adjusted, it.reason, it.adjusted ? 'manual' : null, it.adjusted ? qualityId : null, it.adjusted ? callDate + ' 17:30:00' : null);
          }
          if (fbApplied) {
            const weak = finalItems.filter((i) => i.fin !== 'C' && i.fin !== 'NA').map((i) => i.c.name);
            const strong = finalItems.filter((i) => i.fin === 'C').slice(0, 3).map((i) => i.c.name);
            const sup = DEMO_OPERATORS[oi][1] === 'Equipe Alfa' ? ids['supervisor.alfa'] : ids['supervisor.beta'];
            run(`INSERT INTO feedbacks (evaluation_id, operator_id, applied_by, applied_at, modality, content, strengths, improvements, action_plan, operator_ack)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            evalId, opId, rnd() < 0.5 ? qualityId : sup, callDate + ' 18:10:00', rnd() < 0.7 ? 'Presencial' : 'Remoto (Teams)',
            weak.length ? `Alinhado com o operador os pontos de melhoria: ${weak.join(', ')}. Reforçado o roteiro e ouvido trecho da ligação junto com ele.` : 'Feedback positivo: atendimento aderente ao roteiro. Operador reconhecido pela qualidade.',
            strong.join(', '), weak.join(', ') || null,
            weak.length ? 'Nova monitoria na próxima quinzena com foco nos pontos alinhados.' : null);
          }
        }
      });
    });
    setSetting('demo_seeded', '1');
  });
  console.log('  ▸ Dados de demonstração carregados (usuários demo com senha Px@2026demo).');
}

function clearDemo() {
  tx(() => {
    run('DELETE FROM evaluations WHERE is_demo = 1');
    run('DELETE FROM operators WHERE id NOT IN (SELECT DISTINCT operator_id FROM evaluations)');
    run("DELETE FROM cycles WHERE id NOT IN (SELECT DISTINCT cycle_id FROM evaluations WHERE cycle_id IS NOT NULL) AND audio_folder_url LIKE 'https://onedrive.live.com/?id=EXEMPLO-%'");
    run("DELETE FROM users WHERE username IN ('qualidade','supervisor.alfa','supervisor.beta') AND last_login IS NULL");
  });
}

module.exports = { seedBase, seedDemo, clearDemo, SAMPLE_TRANSCRIPT_REFIN, SAMPLE_TRANSCRIPT_ENTREGA };
