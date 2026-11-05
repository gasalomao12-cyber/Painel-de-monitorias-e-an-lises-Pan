// Análise manual AGV: a analista escolhe a ligação no CSV de metadados do Mosaic (opcional) ou digita os dados,
// marca o roteiro AGV critério a critério e salva. "Salvar e próxima" já abre a próxima ligação do CSV.
// Uma análise salva pode ser aberta de novo e editada; o áudio da ligação pode ser anexado (fica no armazenamento privado).
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
const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.gsm,.ogg,.opus,.m4a,.wma';
const mb = (n) => `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

// Toca o áudio anexado a uma ligação (link assinado de 10 minutos)
export async function playEvalAudio(evId, holder) {
  const { url, name } = await api.get(`/evaluations/${evId}/audio-file`);
  holder.innerHTML = String(html`<audio controls autoplay preload="auto" src="${url}" style="width:100%"></audio><span class="tiny muted">${name}</span>`);
}

export function openManualAgv(ctx, onSaved, { editId = null } = {}) {
  const { store } = ctx;
  const carts = userCarteiras(store.user);
  const fixedCart = viewCarteira(store.user) || (carts.length === 1 ? carts[0] : '');
  const products = [...new Set([...(store.meta.products || []).map((p) => p.product), ...PRODUCTS])];
  const ops = store.meta.operators.filter((o) => o.login);
  const st = { roteiro: 'AGV2', items: {}, fromCsv: false, editId: null, audio: null, audioFile: null };
  const critOf = (r) => store.meta.criteria.filter((c) => c.product === r && c.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  modal({
    title: 'Análise manual AGV',
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
          <section class="am-sec am-saved">
            <div class="am-h"><span class="am-n">${icon('edit')}</span><div><b>Editar uma análise salva</b><span>Busque pelo ID da ligação, login ou nome da análise e abra para corrigir.</span></div></div>
            <div class="row" style="gap:8px"><input class="input sm grow" id="am-sq" placeholder="Buscar análises manuais…" autocomplete="off"></div>
            <div class="am-list" id="am-slist"></div>
          </section>
          <div class="banner info am-editing" id="am-editing" hidden>${icon('edit')}<div class="grow"><b id="am-edit-t">Editando</b><div class="small">As alterações substituem a análise salva. Feedback e contestação continuam ligados a ela.</div></div><button type="button" class="btn sm" id="am-new">${icon('plus')}Nova análise</button></div>
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
              <label class="field am-wide"><span class="lbl">Nome do arquivo de áudio</span><input class="input" name="audio_file" placeholder="Nome do .wav no Mosaic"></label>
              <div class="field am-wide"><span class="lbl">Áudio da ligação</span>
                <div class="am-audio"><label class="btn sm" id="am-aup">${icon('upload')}<span id="am-aname">Anexar áudio (.wav, .mp3…)</span><input type="file" id="am-afile" accept="${AUDIO_ACCEPT}" hidden></label>
                  <span id="am-acur"></span></div>
                <div id="am-aplayer" class="am-aplayer"></div></div>
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

      const reset = () => { st.items = {}; st.fromCsv = false; ['id', 'datetime', 'duration', 'campaign', 'tabulation', 'disconnect', 'customer', 'contract', 'audio_file'].forEach((n) => set(n, '')); $('#am-out', m).value = ''; $('#am-obs', m).value = ''; clearAudio(); drawCrit(); };

      // Áudio: escolhido aqui e enviado ao salvar
      const paintAudio = () => {
        $('#am-aname', m).textContent = st.audioFile ? `${st.audioFile.name} · ${mb(st.audioFile.size)} · vai ao salvar` : st.audio ? 'Trocar o áudio' : 'Anexar áudio (.wav, .mp3…)';
        $('#am-acur', m).innerHTML = st.audio && !st.audioFile ? String(html`<button type="button" class="btn sm ghost" id="am-aplay">${icon('play')}Ouvir ${st.audio.name}</button><button type="button" class="btn-icon" id="am-adel" title="Remover o áudio" aria-label="Remover o áudio">${icon('trash')}</button>`)
          : st.audioFile ? String(html`<button type="button" class="btn-icon" id="am-aclear" title="Não anexar" aria-label="Não anexar">${icon('x')}</button>`) : '';
      };
      const clearAudio = () => { st.audio = null; st.audioFile = null; $('#am-afile', m).value = ''; $('#am-aplayer', m).innerHTML = ''; paintAudio(); };
      $('#am-afile', m).addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 50 * 1024 * 1024) { toast('O áudio passa de 50 MB.', 'err'); e.target.value = ''; return; }
        st.audioFile = file;
        if (!f.elements.audio_file.value) set('audio_file', file.name);
        const holder = $('#am-aplayer', m);
        holder.innerHTML = String(html`<audio controls preload="metadata" style="width:100%"></audio>`);
        holder.querySelector('audio').src = URL.createObjectURL(file);
        paintAudio();
      });
      $('#am-acur', m).addEventListener('click', async (e) => {
        if (e.target.closest('#am-aclear')) { st.audioFile = null; $('#am-afile', m).value = ''; $('#am-aplayer', m).innerHTML = ''; paintAudio(); }
        if (e.target.closest('#am-aplay')) { try { await playEvalAudio(st.editId, $('#am-aplayer', m)); } catch (ex) { toast(ex.message, 'err'); } }
        if (e.target.closest('#am-adel')) {
          try { await api.del(`/evaluations/${st.editId}/audio-file`); st.audio = null; $('#am-aplayer', m).innerHTML = ''; paintAudio(); toast('Áudio removido.'); } catch (ex) { toast(ex.message, 'err'); }
        }
      });

      // Editar uma análise salva
      const exitEdit = () => { st.editId = null; $('#am-editing', m).hidden = true; $('#am-save', m).innerHTML = `${icon('checkCircle')}Salvar análise`; $('.modal-head h3', m.closest('.modal') || m).textContent = 'Análise manual AGV'; };
      const loadEdit = async (id) => {
        try {
          const a = await api.get(`/agv/manual/${id}`);
          reset();
          st.editId = a.id; st.fromCsv = a.from_csv; st.audio = a.audio;
          st.roteiro = a.roteiro; $$('#am-rot button', m).forEach((x) => x.classList.toggle('on', x.dataset.r === a.roteiro));
          set('carteira', a.carteira); set('login', a.login); set('product', a.product);
          Object.entries(a.call).forEach(([k, v]) => set(k, v));
          $('#am-out', m).value = a.outcome; $('#am-an', m).value = a.analysis; $('#am-obs', m).value = a.summary;
          st.items = Object.fromEntries(a.items.map((i) => [i.code, { result: i.result, note: i.note }]));
          drawCrit(); paintAudio();
          $('#am-editing', m).hidden = false;
          $('#am-edit-t', m).textContent = `Editando a análise de ${a.login}${a.call.id ? ` · ligação ${a.call.id}` : ''}`;
          $('#am-save', m).innerHTML = `${icon('checkCircle')}Salvar alterações`;
          $('.modal-head h3', m.closest('.modal') || m).textContent = 'Editar análise manual AGV';
          $$('.am-li', $('#am-slist', m)).forEach((x) => x.classList.toggle('on', Number(x.dataset.eid) === a.id));
        } catch (ex) { toast(ex.message, 'err'); }
      };
      let savedT = 0;
      const drawSaved = async () => {
        const box = $('#am-slist', m);
        try {
          const rows = await api.get(`/agv/manual?q=${encodeURIComponent($('#am-sq', m).value.trim())}`);
          box.innerHTML = String(html`${rows.slice(0, 30).map((r) => html`<button type="button" class="am-li ${r.id === st.editId ? 'on' : ''}" data-eid="${r.id}">
              <b>${r.call_id || `#${r.id}`}</b><span>${r.login}</span><span>${r.call_date ? fmtDate(r.call_date) : ''}</span><span class="am-tab">${r.analysis}${r.score != null ? ` · ${String(r.score).replace('.', ',')}` : ''}</span>${r.audio ? html`<i title="Com áudio">${icon('audio')}</i>` : ''}</button>`)}
            ${rows.length ? '' : html`<p class="small muted">Nenhuma análise manual encontrada.</p>`}`);
        } catch (ex) { box.innerHTML = ''; toast(ex.message, 'err'); }
      };
      $('#am-sq', m).addEventListener('input', () => { clearTimeout(savedT); savedT = setTimeout(drawSaved, 250); });
      $('#am-slist', m).addEventListener('click', (e) => { const b = e.target.closest('.am-li'); if (b) loadEdit(Number(b.dataset.eid)); });
      $('#am-new', m).onclick = () => { exitEdit(); reset(); $$('.am-li', $('#am-slist', m)).forEach((x) => x.classList.remove('on')); };
      const save = async (btn, next) => {
        if (!f.reportValidity()) return;
        const fd = Object.fromEntries(new FormData(f));
        const items = Object.entries(st.items).filter(([, v]) => v.result).map(([code, v]) => ({ code, result: v.result, note: v.note || '' }));
        if (!items.length) { toast('Marque ao menos um critério do roteiro.', 'err'); return; }
        busy(btn, true, 'Salvando');
        try {
          const payload = {
            carteira: fd.carteira || fixedCart, login: fd.login, product: fd.product, roteiro: st.roteiro, items, outcome: $('#am-out', m).value,
            analysis: $('#am-an', m).value, summary: $('#am-obs', m).value, from_csv: st.fromCsv,
            call: { id: fd.id, datetime: fd.datetime, duration: fd.duration, campaign: fd.campaign, tabulation: fd.tabulation, disconnect: fd.disconnect, customer: fd.customer, contract: fd.contract, audio_file: fd.audio_file || st.audioFile?.name || '' },
          };
          const r = st.editId ? await api.put(`/agv/manual/${st.editId}`, payload) : await api.post('/agv/manual', payload);
          let audioMsg = '';
          if (st.audioFile) {
            btn.innerHTML = '<span class="spinner"></span> Enviando o áudio';
            try { await api.upload(`/evaluations/${r.id}/audio-file?name=${encodeURIComponent(st.audioFile.name)}`, st.audioFile); audioMsg = ' · áudio anexado'; }
            catch (ex) { toast(`Análise salva, mas o áudio não foi anexado: ${ex.message}`, 'err', 7000); }
          }
          if (fd.id) done.add(fd.id);
          toast(`${r.edited ? 'Análise atualizada' : 'Análise salva'} · nota ${r.score == null ? '—' : String(r.score).replace('.', ',')}${r.operator_created ? ' · operador novo cadastrado' : ''}${audioMsg}.`);
          onSaved?.(r);
          busy(btn, false);
          if (next) { exitEdit(); reset(); drawList(); if (csv) nextCall(); } else close();
        } catch (ex) { toast(ex.message, 'err'); busy(btn, false); }
      };
      $('#am-save', m).onclick = (e) => save(e.currentTarget, false);
      $('#am-save-next', m).onclick = (e) => save(e.currentTarget, true);
      drawCrit(); drawList(); drawSaved(); paintAudio();
      if (editId) loadEdit(editId);
    },
  });
}
