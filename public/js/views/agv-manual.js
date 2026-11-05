// Análise manual AGV: a analista escolhe a ligação no CSV de metadados do Mosaic (opcional) ou digita os dados,
// marca o roteiro AGV critério a critério e salva. "Salvar e próxima" já abre a próxima ligação do CSV.
import { api } from '../api.js';
import { html, icon, $, $$, toast, modal, busy, fmtDate, PRODUCT, PRODUCTS } from '../ui.js';
import { parseSheetFile } from '../files.js';
import { mapCalls } from './import.js';
import { CARTEIRA_INFO, userCarteiras, viewCarteira } from '../carteira.js';

const ROTEIROS = [['AGV2', 'Esforço negocial'], ['AGV', 'Perguntas do speech']];
const OUTCOMES = ['Acordo com boleto', 'Promessa sem boleto', 'Retorno combinado', 'Sem acordo', 'Sem negociação com o titular', 'Final cortado'];
const RES = [['C', 'Conforme'], ['P', 'Parcial'], ['NC', 'Não conforme'], ['NA', 'N/A']];
const pad = (n) => String(n).padStart(2, '0');
// "2026-11-04 14:32:10" ou "04/11/2026 14:32" → valor de <input type="datetime-local">
function toLocal(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${pad(m[4] || 0)}:${m[5] || '00'}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4] || 0)}:${m[5] || '00'}`;
  return '';
}
// "00:02:32.460" → "02:32"
const dur = (v) => { const s = String(v || '').trim(); const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})/); if (m) return m[1] && Number(m[1]) ? `${m[1]}:${m[2]}:${m[3]}` : `${pad(m[2])}:${m[3]}`; return s; };
const score = (items, crit) => {
  let tot = 0, pts = 0, crit0 = false;
  for (const c of crit) {
    const r = items[c.code]?.result; if (!r || r === 'NA') continue;
    const w = c.weight == null ? 1 : Number(c.weight);
    if (!(w > 0)) { if (r === 'NC' && c.critical) crit0 = true; continue; }
    tot += w; pts += r === 'C' ? w : r === 'P' ? w / 2 : 0; if (r === 'NC' && c.critical) crit0 = true;
  }
  return tot ? (crit0 ? 0 : Math.round((pts / tot) * 1000) / 10) : null;
};

let csv = null;             // { name, rows } do Mosaic, fica entre uma abertura e outra
const done = new Set();     // IDs já analisados nesta sessão

export function openManualAgv(ctx, onSaved) {
  const { store } = ctx;
  const carts = userCarteiras(store.user);
  const fixedCart = viewCarteira(store.user) || (carts.length === 1 ? carts[0] : '');
  const products = [...new Set([...(store.meta.products || []).map((p) => p.product), ...PRODUCTS])];
  const ops = store.meta.operators.filter((o) => o.login);
  const st = { roteiro: 'AGV2', items: {}, fromCsv: false };
  const critOf = (r) => store.meta.criteria.filter((c) => c.product === r && c.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  modal({
    title: 'Nova análise manual AGV',
    wide: true,
    cls: 'am-modal',
    body: html`
      <div class="am">
        <div class="am-col">
          <section class="am-sec">
            <div class="am-h"><span class="am-n">1</span><div><b>Metadados do Mosaic</b><span>Opcional. Anexe o CSV e escolha a ligação: os dados dela entram sozinhos.</span></div></div>
            <label class="drop am-drop" id="am-drop"><input type="file" id="am-file" accept=".csv,.txt,.xlsx" hidden>${icon('upload')}<span id="am-file-t">${csv ? `${csv.name} · ${csv.rows.length} ligações` : 'Anexar CSV do Mosaic (IdContato, Login, DataHoraLigacao…)'}</span></label>
            <div id="am-pick" ${csv ? '' : 'hidden'}>
              <div class="row" style="gap:8px"><input class="input sm grow" id="am-q" placeholder="Buscar por ID, login ou cliente…" autocomplete="off"><button class="btn sm" id="am-next" type="button">${icon('chevRight')}Próxima sem análise</button></div>
              <div class="am-list" id="am-list"></div>
            </div>
          </section>
          <section class="am-sec">
            <div class="am-h"><span class="am-n">2</span><div><b>Dados da ligação</b><span>Complete o que faltar. Login, produto e data são obrigatórios.</span></div></div>
            <form class="am-form" id="am-form" autocomplete="off">
              ${fixedCart ? '' : html`<label class="field"><span class="lbl">Carteira</span><select class="select" name="carteira">${carts.map((c) => html`<option value="${c}">${CARTEIRA_INFO[c]?.label || c}</option>`)}</select></label>`}
              <label class="field"><span class="lbl">Login do operador *</span><input class="input" name="login" list="am-logins" required placeholder="ex.: livdsantos"><datalist id="am-logins">${ops.map((o) => html`<option value="${o.login}">${o.name}</option>`)}</datalist></label>
              <label class="field"><span class="lbl">Produto *</span><select class="select" name="product" required>${products.map((p) => html`<option value="${p}">${PRODUCT[p] || p}</option>`)}</select></label>
              <label class="field"><span class="lbl">ID da ligação (IdContato)</span><input class="input" name="id" placeholder="ex.: 43544599"></label>
              <label class="field"><span class="lbl">Data e hora *</span><input class="input" type="datetime-local" name="datetime" required></label>
              <label class="field"><span class="lbl">Duração</span><input class="input" name="duration" placeholder="mm:ss"></label>
              <label class="field"><span class="lbl">Campanha</span><input class="input" name="campaign"></label>
              <label class="field"><span class="lbl">Tabulação</span><input class="input" name="tabulation"></label>
              <label class="field"><span class="lbl">Desconexão</span><input class="input" name="disconnect" placeholder="Externa, Interna…"></label>
              <label class="field"><span class="lbl">Cliente</span><input class="input" name="customer"></label>
              <label class="field"><span class="lbl">Contrato</span><input class="input" name="contract"></label>
              <label class="field am-wide"><span class="lbl">Arquivo de áudio</span><input class="input" name="audio_file" placeholder="Nome do .wav no Mosaic"></label>
            </form>
          </section>
        </div>
        <div class="am-col">
          <section class="am-sec">
            <div class="am-h"><span class="am-n">3</span><div><b>Roteiro AGV</b><span>Marque cada critério. A nota é calculada na hora.</span></div>
              <div class="am-score"><b id="am-score">—</b><span>nota</span></div></div>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <div class="seg" id="am-rot">${ROTEIROS.map(([k, l]) => html`<button type="button" data-r="${k}" class="${k === st.roteiro ? 'on' : ''}">${l}</button>`)}</div>
              <div class="grow"></div>
              <button class="btn sm ghost" type="button" id="am-allc">${icon('check')}Tudo conforme</button>
            </div>
            <div class="am-crit" id="am-crit"></div>
            <div class="am-form" style="margin-top:12px">
              <label class="field"><span class="lbl">Desfecho</span><select class="select" id="am-out"><option value="">—</option>${OUTCOMES.map((o) => html`<option>${o}</option>`)}</select></label>
              <label class="field"><span class="lbl">Nome da análise</span><input class="input" id="am-an" placeholder="ex.: Manual 05/11"></label>
              <label class="field am-wide"><span class="lbl">Observações da analista</span><textarea class="input textarea" id="am-obs" rows="3" placeholder="O que chamou atenção na ligação, orientação para o feedback…"></textarea></label>
            </div>
          </section>
        </div>
      </div>`,
    foot: html`<span class="small muted" id="am-hint">Atalhos: 1 a 4 marcam o critério em foco; Enter vai para o próximo.</span><div class="grow"></div>
      <button class="btn ghost" data-close>Cancelar</button>
      <button class="btn" id="am-save-next">${icon('chevRight')}Salvar e próxima</button>
      <button class="btn primary" id="am-save">${icon('checkCircle')}Salvar análise</button>`,
    onMount: (m, close) => {
      const f = $('#am-form', m);
      const set = (name, v) => { const i = f.elements[name]; if (i) i.value = v ?? ''; };
      const drawCrit = () => {
        const crit = critOf(st.roteiro);
        $('#am-crit', m).innerHTML = crit.length ? String(html`${crit.map((c, k) => html`<div class="am-c" data-code="${c.code}" tabindex="0">
            <div class="am-ct"><span class="am-k">${String(k + 1).padStart(2, '0')}</span><div class="grow"><b>${c.name}</b>${c.stage ? html`<span>${c.stage}${c.critical ? ' · crítico' : ''}</span>` : ''}</div>
              <div class="am-rs">${RES.map(([r, l]) => html`<button type="button" class="am-r r-${r} ${st.items[c.code]?.result === r ? 'on' : ''}" data-v="${r}" title="${l}">${r === 'NA' ? 'N/A' : r}</button>`)}</div></div>
            <input class="input sm am-note" placeholder="Observação deste critério (opcional)" value="${st.items[c.code]?.note || ''}" ${st.items[c.code]?.result && st.items[c.code].result !== 'C' ? '' : 'hidden'}>
          </div>`)}`) : '<p class="muted small">Este roteiro ainda não tem critérios ativos.</p>';
        paintScore();
      };
      const paintScore = () => { const s = score(st.items, critOf(st.roteiro)); const el = $('#am-score', m); el.textContent = s == null ? '—' : String(s).replace('.', ','); el.className = s == null ? '' : s >= 85 ? 'ok' : s >= 65 ? 'warn' : 'bad'; };
      const mark = (row, r) => {
        const code = row.dataset.code; st.items[code] = { ...(st.items[code] || {}), result: r };
        $$('.am-r', row).forEach((b) => b.classList.toggle('on', b.dataset.v === r));
        $('.am-note', row).hidden = r === 'C';
        paintScore();
      };
      $('#am-crit', m).addEventListener('click', (e) => { const b = e.target.closest('.am-r'); if (b) mark(b.closest('.am-c'), b.dataset.v); });
      $('#am-crit', m).addEventListener('input', (e) => { if (e.target.classList.contains('am-note')) { const code = e.target.closest('.am-c').dataset.code; st.items[code] = { ...(st.items[code] || {}), note: e.target.value }; } });
      $('#am-crit', m).addEventListener('keydown', (e) => {
        const row = e.target.closest('.am-c'); if (!row || e.target.classList.contains('am-note')) return;
        const k = { 1: 'C', 2: 'P', 3: 'NC', 4: 'NA' }[e.key];
        if (k) { e.preventDefault(); mark(row, k); row.nextElementSibling?.focus(); }
        if (e.key === 'Enter') { e.preventDefault(); row.nextElementSibling?.focus(); }
      });
      $$('#am-rot button', m).forEach((b) => b.addEventListener('click', () => { st.roteiro = b.dataset.r; st.items = {}; $$('#am-rot button', m).forEach((x) => x.classList.toggle('on', x === b)); drawCrit(); }));
      $('#am-allc', m).onclick = () => { critOf(st.roteiro).forEach((c) => { st.items[c.code] = { ...(st.items[c.code] || {}), result: 'C' }; }); drawCrit(); };

      // CSV do Mosaic
      const fill = (c) => {
        st.fromCsv = true;
        set('login', c.login?.toLowerCase()); set('id', c.id); set('datetime', toLocal(c.datetime)); set('duration', dur(c.duration));
        set('campaign', c.campaign); set('tabulation', c.tabulation); set('disconnect', c.disconnect); set('customer', c.customer); set('contract', c.contract); set('audio_file', c.audio_file);
        const prodHint = `${c.operation || ''} ${c.campaign || ''} ${c.audio_file || ''}`.toUpperCase();
        const guess = products.find((p) => prodHint.includes(p)) || (/CART/.test(prodHint) ? 'CARTOES' : /CONSIG/.test(prodHint) ? 'CONSIGNADO' : /VEIC/.test(prodHint) ? 'VEICULOS' : /REFIN/.test(prodHint) ? 'REFIN' : null);
        if (guess) set('product', guess);
        if (!$('#am-an', m).value && c.datetime) { const d = toLocal(c.datetime); if (d) $('#am-an', m).value = `Manual ${d.slice(8, 10)}/${d.slice(5, 7)}`; }
        $$('.am-li', m).forEach((x) => x.classList.toggle('on', x.dataset.id === c.id));
        toast(`Ligação ${c.id} carregada. Agora marque o roteiro.`);
        $('#am-crit .am-c', m)?.focus();
      };
      const drawList = () => {
        if (!csv) return;
        const q = $('#am-q', m).value.trim().toLowerCase();
        const rows = csv.rows.filter((r) => !q || `${r.id} ${r.login} ${r.customer || ''}`.toLowerCase().includes(q)).slice(0, 40);
        $('#am-list', m).innerHTML = String(html`${rows.map((r) => html`<button type="button" class="am-li ${done.has(r.id) ? 'done' : ''}" data-id="${r.id}">
            <b>${r.id}</b><span>${r.login}</span><span>${fmtDate(String(r.datetime).slice(0, 10))} ${String(r.datetime).slice(11, 16)}</span><span class="am-tab">${r.tabulation || r.campaign || ''}</span>${done.has(r.id) ? html`<i>${icon('check')}</i>` : ''}</button>`)}
          ${rows.length ? '' : html`<p class="small muted">Nenhuma ligação encontrada.</p>`}`);
      };
      $('#am-list', m).addEventListener('click', (e) => { const b = e.target.closest('.am-li'); if (b) fill(csv.rows.find((r) => r.id === b.dataset.id)); });
      $('#am-q', m).addEventListener('input', drawList);
      const nextCall = () => { const r = csv?.rows.find((x) => !done.has(x.id)); if (r) fill(r); else toast('Todas as ligações do CSV já foram analisadas.'); };
      $('#am-next', m).onclick = nextCall;
      $('#am-file', m).addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          const rows = mapCalls(await parseSheetFile(file));
          if (!rows || !rows.length) throw new Error('Não reconheci o CSV do Mosaic (precisa das colunas IdContato, Login e DataHoraLigacao).');
          csv = { name: file.name, rows };
          $('#am-file-t', m).textContent = `${file.name} · ${rows.length} ligações`;
          $('#am-pick', m).hidden = false; drawList();
          toast(`${rows.length} ligações no CSV. Escolha uma para começar.`);
        } catch (ex) { toast(ex.message, 'err'); }
      });

      const reset = () => { st.items = {}; st.fromCsv = false; ['id', 'datetime', 'duration', 'campaign', 'tabulation', 'disconnect', 'customer', 'contract', 'audio_file'].forEach((n) => set(n, '')); $('#am-out', m).value = ''; $('#am-obs', m).value = ''; drawCrit(); };
      const save = async (btn, next) => {
        if (!f.reportValidity()) return;
        const fd = Object.fromEntries(new FormData(f));
        const items = Object.entries(st.items).filter(([, v]) => v.result).map(([code, v]) => ({ code, result: v.result, note: v.note || '' }));
        if (!items.length) { toast('Marque ao menos um critério do roteiro.', 'err'); return; }
        busy(btn, true, 'Salvando');
        try {
          const r = await api.post('/agv/manual', {
            carteira: fd.carteira || fixedCart, login: fd.login, product: fd.product, roteiro: st.roteiro, items, outcome: $('#am-out', m).value,
            analysis: $('#am-an', m).value, summary: $('#am-obs', m).value, from_csv: st.fromCsv,
            call: { id: fd.id, datetime: fd.datetime, duration: fd.duration, campaign: fd.campaign, tabulation: fd.tabulation, disconnect: fd.disconnect, customer: fd.customer, contract: fd.contract, audio_file: fd.audio_file },
          });
          if (fd.id) done.add(fd.id);
          toast(`Análise salva · nota ${r.score == null ? '—' : String(r.score).replace('.', ',')}${r.operator_created ? ' · operador novo cadastrado' : ''}.`);
          onSaved?.(r);
          busy(btn, false);
          if (next) { reset(); drawList(); if (csv) nextCall(); } else close();
        } catch (ex) { toast(ex.message, 'err'); busy(btn, false); }
      };
      $('#am-save', m).onclick = (e) => save(e.currentTarget, false);
      $('#am-save-next', m).onclick = (e) => save(e.currentTarget, true);
      drawCrit(); drawList();
    },
  });
}
