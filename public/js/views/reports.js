import { html, icon, $, $$, toast } from '../ui.js';

const TYPES = [
  { id: 'geral', icon: 'dashboard', title: 'Visão geral', desc: 'Report quinzenal completo: KPIs, evolução, dispersão, critérios, ranking e destaques.' },
  { id: 'comparativo', icon: 'layers', title: 'Comparativo entre quinzenas', desc: 'Lado a lado de duas ou mais quinzenas, com variação por operador e por critério.' },
  { id: 'produto', icon: 'scale', title: 'Refinanciamento × Entrega', desc: 'Compara os dois produtos: notas, critérios ofensores e evolução.' },
  { id: 'individual', icon: 'user', title: 'Individual do operador', desc: 'Raio-x de um operador: evolução vs. equipe, critérios e feedbacks.' },
];
const SECTIONS = [
  ['capa', 'Capa'], ['resumo', 'Resumo executivo'], ['evolucao', 'Evolução e comparativo'], ['dispersao', 'Gráficos de dispersão'],
  ['criterios', 'Critérios'], ['ranking', 'Ranking de operadores'], ['destaques', 'Destaques e feedbacks'], ['speech', 'Qualidade do speech (ajustes)'],
];

export async function render(el, _p, ctx) {
  const { store } = ctx;
  const m = store.meta;
  const saved = JSON.parse(localStorage.getItem('px_report_cfg') || '{}');
  const presetOp = sessionStorage.getItem('px_report_op');
  sessionStorage.removeItem('px_report_op');
  const cfg = {
    type: presetOp ? 'individual' : saved.type || 'geral',
    cycles: saved.cycles?.filter((id) => m.cycles.some((c) => c.id === id)) || (store.cycle ? [Number(store.cycle)] : m.cycles.slice(0, 1).map((c) => c.id)),
    product: saved.product || '', team: saved.team || '', operator_id: presetOp || saved.operator_id || '',
    theme: saved.theme || 'dark', title: '', subtitle: saved.subtitle || '',
    sections: saved.sections || SECTIONS.map((s) => s[0]),
  };
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Dashboards &amp; reports</h2><p>Gere o report de qualidade com capa e design de apresentação. Imprima em PDF ou baixe o HTML para enviar.</p></div></div>
    <div class="grid g-3">
      <div class="span-2 stack" style="gap:18px">
        <div class="card card-pad"><h3 style="margin:0 0 12px;font-size:15px">Tipo de dashboard</h3>
          <div class="grid g-2" id="r-types">${TYPES.map((t) => html`<div class="theme-opt ${cfg.type === t.id ? 'on' : ''}" data-type="${t.id}" role="button" tabindex="0" style="align-items:flex-start">
            <span class="k-ic" style="width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand);flex:none">${icon(t.icon)}</span>
            <div><b>${t.title}</b><div class="tiny muted">${t.desc}</div></div></div>`)}</div></div>
        <div class="card card-pad"><h3 style="margin:0 0 4px;font-size:15px">Quinzenas</h3><p class="small muted" style="margin:0 0 12px" id="r-cyc-hint"></p>
          <div class="row" id="r-cycles">${m.cycles.map((c) => html`<label class="chip outline" style="cursor:pointer;padding:7px 12px"><input type="checkbox" value="${c.id}" ${cfg.cycles.includes(c.id) ? 'checked' : ''} style="accent-color:var(--brand)"> ${c.name}</label>`)}</div>
          <div class="row mt"><button class="btn sm ghost" id="r-last2">Últimas 2</button><button class="btn sm ghost" id="r-last4">Últimas 4</button><button class="btn sm ghost" id="r-all">Todas</button><button class="btn sm ghost" id="r-none">Limpar</button></div></div>
        <div class="card card-pad"><h3 style="margin:0 0 12px;font-size:15px">Recorte</h3>
          <div class="grid g-3">
            <div class="field"><label for="r-prod">Produto</label><select class="select" id="r-prod"><option value="">Refinanciamento + Entrega</option><option value="REFIN">Refinanciamento</option><option value="ENTREGA">Entrega Amigável</option></select></div>
            <div class="field"><label for="r-team">Equipe</label><select class="select" id="r-team"><option value="">Todas</option>${m.teams.map((t) => html`<option>${t}</option>`)}</select></div>
            <div class="field" id="r-op-f"><label for="r-op">Operador</label><select class="select" id="r-op"><option value="">Selecione…</option>${m.operators.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></div>
          </div></div>
      </div>
      <div class="stack" style="gap:18px">
        <div class="card card-pad"><h3 style="margin:0 0 12px;font-size:15px">Apresentação</h3>
          <div class="field"><label for="r-title">Título da capa</label><input class="input" id="r-title" placeholder="Gerado automaticamente"></div>
          <div class="field"><label for="r-sub">Subtítulo</label><input class="input" id="r-sub" value="${cfg.subtitle}" placeholder="Ex.: Operação Banco · Célula Auto"></div>
          <div class="field"><span class="lbl">Estilo</span><div class="theme-pick">
            <div class="theme-opt ${cfg.theme === 'dark' ? 'on' : ''}" data-rtheme="dark" role="button" tabindex="0"><span class="sw d"></span><b class="small">Premium escuro</b></div>
            <div class="theme-opt ${cfg.theme === 'light' ? 'on' : ''}" data-rtheme="light" role="button" tabindex="0"><span class="sw l"></span><b class="small">Claro (impressão)</b></div></div></div>
          <div class="field"><span class="lbl">Seções</span><div class="stack" style="gap:6px" id="r-secs">${SECTIONS.map(([id, l]) => html`<label class="check small"><input type="checkbox" value="${id}" ${cfg.sections.includes(id) ? 'checked' : ''}>${l}</label>`)}</div></div>
        </div>
        <button class="btn primary lg block" id="r-go">${icon('report')}Gerar dashboard</button>
        <p class="tiny muted center" style="margin:0">Abre em nova aba. Use “Imprimir / PDF” (paisagem) ou “Baixar HTML”.</p>
      </div>
    </div>`);

  $('#r-prod').value = cfg.product; $('#r-team').value = cfg.team; $('#r-op').value = cfg.operator_id;
  const sync = () => {
    $$('#r-types [data-type]').forEach((x) => x.classList.toggle('on', x.dataset.type === cfg.type));
    $('#r-op-f').style.display = cfg.type === 'individual' ? '' : 'none';
    $('#r-cyc-hint').textContent = { geral: 'Selecione uma ou mais quinzenas (os números serão consolidados).', comparativo: 'Selecione ao menos duas quinzenas para comparar.', produto: 'Selecione as quinzenas do recorte.', individual: 'Selecione as quinzenas para o histórico do operador.' }[cfg.type];
    const sec = $('#r-secs');
    sec.querySelectorAll('input').forEach((i) => { i.closest('label').style.display = cfg.type === 'individual' && ['ranking', 'speech'].includes(i.value) ? 'none' : ''; });
  };
  $$('#r-types [data-type]').forEach((x) => {
    const pick = () => { cfg.type = x.dataset.type; sync(); };
    x.addEventListener('click', pick); x.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
  });
  $$('[data-rtheme]').forEach((x) => x.addEventListener('click', () => { cfg.theme = x.dataset.rtheme; $$('[data-rtheme]').forEach((y) => y.classList.toggle('on', y === x)); }));
  const setCycles = (ids) => $$('#r-cycles input').forEach((i) => { i.checked = ids.includes(Number(i.value)); });
  $('#r-last2').onclick = () => setCycles(m.cycles.slice(0, 2).map((c) => c.id));
  $('#r-last4').onclick = () => setCycles(m.cycles.slice(0, 4).map((c) => c.id));
  $('#r-all').onclick = () => setCycles(m.cycles.map((c) => c.id));
  $('#r-none').onclick = () => setCycles([]);
  sync();

  $('#r-go').onclick = () => {
    cfg.cycles = $$('#r-cycles input:checked').map((i) => Number(i.value));
    cfg.product = $('#r-prod').value; cfg.team = $('#r-team').value; cfg.operator_id = $('#r-op').value;
    cfg.title = $('#r-title').value.trim(); cfg.subtitle = $('#r-sub').value.trim();
    cfg.sections = $$('#r-secs input:checked').map((i) => i.value);
    if (!cfg.cycles.length) return toast('Selecione ao menos uma quinzena.', 'err');
    if (cfg.type === 'comparativo' && cfg.cycles.length < 2) return toast('Selecione duas ou mais quinzenas para o comparativo.', 'err');
    if (cfg.type === 'individual' && !cfg.operator_id) return toast('Selecione o operador.', 'err');
    localStorage.setItem('px_report_cfg', JSON.stringify({ ...cfg, title: '' }));
    const p = new URLSearchParams({ type: cfg.type, cycles: cfg.cycles.join(','), product: cfg.product, team: cfg.team, operator_id: cfg.operator_id, theme: cfg.theme, title: cfg.title, subtitle: cfg.subtitle, sections: cfg.sections.join(',') });
    window.open(`/report.html?${p}`, '_blank', 'noopener');
  };
}
