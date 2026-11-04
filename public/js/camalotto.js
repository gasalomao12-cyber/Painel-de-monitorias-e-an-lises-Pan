import { api } from './api.js';
import { html, icon, $ } from './ui.js';

// Camalotto, o instrutor da PX Monitorias:
//  • introdução guiada na primeira entrada (cada função em destaque na própria tela); pular ou concluir encerra
//    para sempre aquela pessoa (marca no servidor);
//  • botão de ajuda no canto da tela: busca na base de conhecimento e, com a IA configurada, responde qualquer dúvida.
const IMG = (p) => `brand/camalotto/${p}.webp`;
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const first = (u) => String(u?.display_name || u?.name || '').split(' ')[0].toLowerCase().replace(/^./, (c) => c.toUpperCase());

let KBC = null;
const kb = async () => { if (!KBC) KBC = await api.get('/help/kb').catch(() => ({ articles: [], ai: false })); return KBC; };
const STOP = new Set('a o as os de da do das dos e em no na nos nas um uma para por com como que eu meu minha qual onde quando fazer faço posso tem ter se ao à é'.split(' '));
function search(articles, q, n = 3) {
  const words = plain(q).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return [];
  return articles.map((a) => {
    const k = plain(a.keys), t = plain(a.title), x = plain(a.text);
    let s = 0;
    for (const w of words) { const st = w.slice(0, Math.max(4, w.length - 2)); if (t.includes(st)) s += 3; if (k.includes(st)) s += 2; if (x.includes(st)) s += 1; }
    return { a, s };
  }).filter((r) => r.s >= 2).sort((x, y) => y.s - x.s).slice(0, n).map((r) => r.a);
}

// ---------------------------------------------------------------- destaque (spotlight) e cartão do Camalotto
function placeCard(card, rect) {
  const vw = innerWidth, vh = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, m = 16;
  let x, y;
  if (!rect) { x = (vw - cw) / 2; y = (vh - ch) / 2; }
  else if (rect.right + cw + 28 < vw && rect.left < vw / 2) { x = rect.right + 20; y = rect.top + rect.height / 2 - ch / 2; }
  else if (rect.bottom + ch + 24 < vh) { x = rect.left + rect.width / 2 - cw / 2; y = rect.bottom + 18; }
  else if (rect.top - ch - 24 > 0) { x = rect.left + rect.width / 2 - cw / 2; y = rect.top - ch - 18; }
  else { x = rect.left - cw - 20; y = rect.top + rect.height / 2 - ch / 2; }
  card.style.left = `${Math.max(m, Math.min(vw - cw - m, x))}px`;
  card.style.top = `${Math.max(m, Math.min(vh - ch - m, y))}px`;
}
const visibleEl = (sel) => { const el = sel && document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight ? el : null; };

// Passos da introdução: cada um só entra se o elemento existir para o perfil e a carteira da pessoa
function tourSteps(user) {
  const n = first(user);
  const nav = (id) => `.sb-nav [data-nav="${id}"]`;
  return [
    { pose: 'oi', title: `Oi${n ? `, ${n}` : ''}! Eu sou o Camalotto 👋`, text: 'Sou o instrutor da PX Monitorias. Em um minutinho te mostro onde fica cada função da plataforma. Se preferir, pode pular: eu fico no canto da tela para qualquer dúvida.', intro: true },
    { sel: '.tb-carteira, .sb-carteira', pose: 'apresenta', title: 'Esta é a sua carteira', text: 'Você vê só as análises, os gráficos e os operadores da sua carteira, com as cores e a logo dela. Quem tem mais de uma carteira escolhe no seletor do topo.' },
    { sel: nav('painel'), pose: 'aponta-esq', title: 'Painel', text: 'A visão geral: nota média, aderência ao roteiro, feedbacks aplicados e falhas críticas, com filtros de quinzena, produto e segmento.' },
    { sel: nav('atendimentos'), pose: 'aponta-esq', title: 'Atendimentos', text: 'Cada card é uma monitoria. Abra para ver os critérios, o áudio, a transcrição e o feedback. Dá para filtrar, buscar pelo protocolo e exportar em CSV.' },
    { sel: nav('operadores'), pose: 'aponta-esq', title: 'Operadores', text: 'O desempenho de cada operador, a evolução por quinzena e a situação dos feedbacks.' },
    { sel: nav('esforco'), pose: 'aponta-esq', title: 'Esforço negocial e AGV', text: 'Como o operador negociou: sondagem, valor, escada de ofertas, tentativa após o não. Com ranking, evolução e mapa de desempenho.' },
    { sel: nav('quedas'), pose: 'aponta-esq', title: 'Queda de ligação', text: 'A força-tarefa: ouça o áudio, diga quem derrubou a ligação e se a tabulação estava certa. Enter confirma e o CSV sai com os dias que você escolher.' },
    { sel: nav('analises'), pose: 'aponta-esq', title: 'Análises da carteira', text: 'Os relatórios importados (conversão e eficiência, análises de speech), com a leitura de cada login e o arquivo original.' },
    { sel: nav('nota-qualidade'), pose: 'comemora', title: 'Nota de qualidade', text: 'A nota fechada de cada mês, por supervisão e por operador, contra a meta de 80, com as contestações e as ações da analista.' },
    { sel: nav('importar'), pose: 'dica', title: 'Importar monitorias', text: 'Aqui entram os dashboards e análises (.html), a planilha do speech, a lista do discador e o capacity de cada setor. A plataforma reconhece o arquivo e mostra uma prévia antes de gravar.' },
    { sel: nav('feedbacks/pendentes'), pose: 'aponta-esq', title: 'Feedbacks pendentes', text: 'Um cartão por operador com todos os atendimentos auditados: clique em "Aplicar feedback" e registre tudo de uma vez. Quem saiu do time pode sair da lista.' },
    { sel: nav('contestacoes'), pose: 'pensa', title: 'Contestações', text: 'O supervisor contesta uma monitoria pelo próprio atendimento e a Qualidade responde aqui, aceitando ou mantendo a análise.' },
    { sel: nav('acoes'), pose: 'aponta-esq', title: 'Controle de ações', text: 'Tudo o que é feito com os operadores, como na planilha de ações. Feedbacks entram sozinhos; calibragens e treinamentos você registra aqui.' },
    { sel: nav('relatorios'), pose: 'apresenta', title: 'Dashboards prontos', text: 'Gere o report de qualidade com capa e gráficos, pronto para apresentar: "Imprimir / PDF" ou "Baixar HTML".' },
    { sel: nav('criterios'), pose: 'confiante', title: 'Critérios de avaliação', text: 'Os roteiros de monitoria: crie critérios com peso e marque os críticos (zeram a nota quando não conformes).' },
    { sel: nav('usuarios'), pose: 'confiante', title: 'Usuários & acessos', text: 'Crie acessos com perfil e carteira, resete senhas e desative quem saiu.' },
    { sel: '#global-search', pose: 'dica', title: 'Busca rápida', text: 'Digite o nome do operador, um protocolo ou uma página. Atalho: Ctrl K.' },
    { sel: '#shortcut-btn', pose: 'joinha', title: 'Atalho na área de trabalho', text: 'Instale a PX como aplicativo: o ícone fica na área de trabalho e a plataforma abre em janela própria.' },
    { sel: '#bug-top', pose: 'pensa', title: 'Reportar bug', text: 'Encontrou algo estranho? Conte aqui, com um print se puder, e acompanhe o andamento.' },
    { sel: '#cm-fab', pose: 'top', title: 'E eu fico aqui!', text: 'Sempre que surgir uma dúvida, clique em mim: como criar critérios, importar monitorias, exportar CSV, baixar dashboards, aplicar feedbacks e o que mais precisar.', last: true },
  ];
}

function runTour(store) {
  const steps = tourSteps(store.user).filter((s) => !s.sel || visibleEl(s.sel));
  let i = 0;
  const ov = document.createElement('div');
  ov.className = 'cm-tour';
  ov.innerHTML = '<div class="cm-hole"></div><div class="cm-card" role="dialog" aria-modal="true" aria-live="polite"></div>';
  document.body.appendChild(ov);
  const hole = $('.cm-hole', ov), card = $('.cm-card', ov);
  const finish = async (skipped) => {
    document.removeEventListener('keydown', onKey); removeEventListener('resize', draw);
    ov.remove();
    store.user.guide_done = true;
    api.post('/help/guide-done', { skipped }).catch(() => {});
    if (skipped) skippedCard(store);
  };
  function draw() {
    const s = steps[i];
    const el = s.sel ? visibleEl(s.sel) : null;
    const r = el?.getBoundingClientRect();
    if (r) { const p = 6; Object.assign(hole.style, { display: 'block', left: `${r.left - p}px`, top: `${r.top - p}px`, width: `${r.width + p * 2}px`, height: `${r.height + p * 2}px` }); }
    else hole.style.display = 'none';
    ov.classList.toggle('dim', !r);
    card.innerHTML = String(html`<img class="cm-pose" src="${IMG(s.pose)}" alt="Camalotto">
      <div class="cm-bubble"><div class="cm-step">${s.intro ? 'Introdução guiada' : `${i} de ${steps.length - 1}`}</div><h3>${s.title}</h3><p>${s.text}</p>
        <div class="cm-dots">${steps.slice(1).map((_, k) => html`<i class="${k + 1 === i ? 'on' : k + 1 < i ? 'done' : ''}"></i>`)}</div>
        <div class="cm-btns">${s.last ? '' : html`<button class="btn ghost sm" data-skip>Pular introdução</button>`}<div class="grow"></div>
          ${i > 0 ? html`<button class="btn sm" data-prev>${icon('chevLeft')}Voltar</button>` : ''}
          <button class="btn primary sm" data-next>${s.intro ? 'Vamos lá' : s.last ? 'Concluir' : 'Próximo'}${s.last ? '' : html`${icon('chevRight')}`}</button></div></div>`);
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    placeCard(card, r);
    $('[data-next]', card).onclick = () => { if (s.last) finish(false); else { i++; draw(); } };
    $('[data-prev]', card)?.addEventListener('click', () => { i--; draw(); });
    $('[data-skip]', card)?.addEventListener('click', () => finish(true));
    $('[data-next]', card).focus();
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(true); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); $('[data-next]', card)?.click(); }
    else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); i--; draw(); }
  };
  document.addEventListener('keydown', onKey);
  addEventListener('resize', draw);
  draw();
}

// Pulou a introdução: avisa onde o Camalotto fica
function skippedCard(store) {
  const fab = $('#cm-fab');
  fab?.classList.add('pulse');
  const ov = document.createElement('div');
  ov.className = 'cm-tour dim';
  ov.innerHTML = String(html`<div class="cm-card in cm-skip" role="dialog" aria-modal="true"><img class="cm-pose" src="${IMG('joinha')}" alt="Camalotto">
    <div class="cm-bubble"><h3>Tudo bem${first(store.user) ? `, ${first(store.user)}` : ''}!</h3>
      <p>Fico à disposição aqui no canto da tela. Sempre que surgir uma dúvida no decorrer das análises, é só clicar em mim: eu explico como importar monitorias, aplicar feedbacks, exportar CSV, baixar dashboards e muito mais.</p>
      <div class="cm-btns"><div class="grow"></div><button class="btn primary sm" data-ok>Combinado!</button></div></div></div>`);
  document.body.appendChild(ov);
  const card = $('.cm-card', ov);
  placeCard(card, fab?.getBoundingClientRect() || null);
  const close = () => { ov.remove(); setTimeout(() => fab?.classList.remove('pulse'), 4000); };
  $('[data-ok]', ov).onclick = close; $('[data-ok]', ov).focus();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}

// Introdução na primeira entrada (depois das boas-vindas)
export function maybeStartTour(store) {
  if (!store.user || store.user.guide_done || matchMedia('(max-width: 760px)').matches) return false;
  setTimeout(() => { if (!document.querySelector('.overlay, .cm-tour')) runTour(store); }, 900);
  return true;
}

// ---------------------------------------------------------------- botão e painel de ajuda
export function mountHelp(store, { navigate }) {
  document.querySelectorAll('#cm-fab, .cm-panel').forEach((x) => x.remove());
  const fab = document.createElement('button');
  fab.id = 'cm-fab'; fab.className = 'cm-fab'; fab.setAttribute('aria-label', 'Ajuda do Camalotto'); fab.title = 'Dúvidas? Fale com o Camalotto';
  fab.innerHTML = `<img src="${IMG('avatar')}" alt=""><span class="cm-fab-tip">Dúvidas?</span>`;
  document.body.appendChild(fab);
  let panel = null;
  fab.onclick = () => { if (panel) { panel.remove(); panel = null; fab.classList.remove('open'); } else { panel = openPanel(store, navigate, () => { panel = null; fab.classList.remove('open'); }); fab.classList.add('open'); } };
}

function openPanel(store, navigate, onClose) {
  const p = document.createElement('section');
  p.className = 'cm-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Ajuda do Camalotto');
  p.innerHTML = String(html`<header><img src="${IMG('avatar')}" alt=""><div><b>Camalotto</b><small>Instrutor da PX Monitorias</small></div><div class="grow"></div>
      <button class="btn-icon" data-close aria-label="Fechar">${icon('x')}</button></header>
    <div class="cm-msgs" aria-live="polite"></div>
    <div class="cm-chips"></div>
    <form class="cm-ask"><input class="input" name="q" placeholder="Pergunte ao Camalotto…" autocomplete="off" maxlength="600"><button class="btn primary" aria-label="Enviar">${icon('arrowRight')}</button></form>
    <footer><button class="btn ghost sm" data-tour>${icon('play')}Refazer a introdução</button></footer>`);
  document.body.appendChild(p);
  const msgs = $('.cm-msgs', p), chips = $('.cm-chips', p), form = $('.cm-ask', p);
  const close = () => { p.remove(); onClose(); };
  $('[data-close]', p).onclick = close;
  p.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const add = (who, content) => {
    const d = document.createElement('div'); d.className = `cm-msg ${who}`; d.innerHTML = String(content); msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  };
  const show = (sel) => {
    close();
    const el = visibleEl(sel); if (!el) return;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const ring = document.createElement('div'); ring.className = 'cm-ring';
    Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    document.body.appendChild(ring); setTimeout(() => ring.remove(), 3200);
  };
  const article = (a) => html`<b>${a.title}</b><p>${a.text}</p>${a.route ? html`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sm" data-go="${a.route}">${icon('arrowRight')}Ir para a tela</button>${document.querySelector(`.sb-nav [data-nav="${a.route}"]`) ? html`<button class="btn ghost sm" data-show="${a.route}">${icon('eye')}Me mostre no menu</button>` : ''}</div>` : ''}`;
  msgs.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { close(); navigate(g.dataset.go); return; }
    const s = e.target.closest('[data-show]'); if (s) show(`.sb-nav [data-nav="${s.dataset.show}"]`);
    const a = e.target.closest('[data-art]'); if (a) { const art = KBC.articles.find((x) => x.id === a.dataset.art); if (art) add('bot', article(art)); }
  });
  add('bot', html`<div class="cm-hello"><img src="${IMG('apresenta')}" alt=""><div><b>Oi${first(store.user) ? `, ${first(store.user)}` : ''}! Em que posso ajudar?</b><p>Escreva a sua dúvida ou escolha um assunto abaixo.</p></div></div>`);
  kb().then(({ articles }) => {
    const page = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'painel');
    const here = articles.filter((a) => a.route && (page === a.route || page.startsWith(`${a.route}/`)));
    const common = ['importar', 'feedback', 'exportar', 'dashboards', 'criterios', 'nova-monitoria', 'capacity', 'quedas'].map((id) => articles.find((a) => a.id === id)).filter(Boolean);
    chips.innerHTML = String(html`${[...new Map([...here, ...common].map((a) => [a.id, a])).values()].slice(0, 8).map((a) => html`<button class="chip" data-art="${a.id}">${a.title}</button>`)}`);
  });
  chips.addEventListener('click', (e) => { const c = e.target.closest('[data-art]'); if (!c) return; const art = KBC?.articles.find((x) => x.id === c.dataset.art); if (art) { add('me', html`${art.title}`); add('bot', article(art)); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = form.q.value.trim(); if (q.length < 3) return;
    form.q.value = '';
    add('me', html`${q}`);
    const { articles, ai } = await kb();
    const found = search(articles, q);
    if (ai) {
      const wait = add('bot', html`<span class="cm-typing"><i></i><i></i><i></i></span>`);
      let r = null;
      try { r = await api.post('/help/ask', { question: q, page: location.hash.slice(2) }); } catch { r = null; }
      if (r?.answer) {
        wait.innerHTML = String(html`<p style="white-space:pre-line;margin:0">${r.answer}</p>${found.length ? html`<div class="cm-rel"><small>Ver também:</small>${found.map((a) => html`<button class="chip" data-art="${a.id}">${a.title}</button>`)}</div>` : ''}`);
        msgs.scrollTop = msgs.scrollHeight;
        return;
      }
      wait.remove();
    }
    if (found.length) {
      add('bot', article(found[0]));
      if (found.length > 1) add('bot', html`<div class="cm-rel"><small>Talvez também ajude:</small>${found.slice(1).map((a) => html`<button class="chip" data-art="${a.id}">${a.title}</button>`)}</div>`);
    } else {
      add('bot', html`<div class="cm-hello"><img src="${IMG('pensa')}" alt=""><div><b>Hum, essa eu ainda não sei.</b><p>Tente com outras palavras (ex.: "como exportar CSV") ou use "Reportar bug" no topo para falar com a equipe.</p></div></div>`);
    }
  });
  $('[data-tour]', p).onclick = () => { close(); runTour(store); };
  setTimeout(() => form.q.focus(), 50);
  return p;
}
