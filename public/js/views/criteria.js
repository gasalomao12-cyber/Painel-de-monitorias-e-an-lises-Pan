import { api } from '../api.js';
import { html, icon, $, $$, toast, modal, busy } from '../ui.js';

const GROUPS = [['AMBOS', 'Comuns aos dois produtos'], ['REFIN', 'Refinanciamento'], ['ENTREGA', 'Entrega Amigável']];

export async function render(el, _p, ctx) {
  const crit = ctx.store.meta.criteria;
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Critérios de avaliação</h2><p>Formulário de monitoria usado pelo speech, pela IA e pelos analistas. Peso define a importância; crítico em “Não conforme” zera a nota.</p></div><div class="grow"></div>
      <button class="btn primary" id="cr-new">${icon('plus')}Novo critério</button></div>
    <div class="banner info">${icon('info')}<div>Regra de nota: Conforme = 100% do peso · Parcial = 50% · Não conforme = 0 · N/A sai da base. Alterações valem para novas monitorias e para recálculos feitos a partir de agora.</div></div>
    ${GROUPS.map(([g, label]) => html`<div class="card mb"><div class="card-head"><h3>${label}</h3><span class="chip">${crit.filter((c) => c.product === g).length}</span></div>
      <div class="card-body"><div class="table-wrap"><table class="tbl"><thead><tr><th>Código</th><th>Critério</th><th class="right">Peso</th><th>Crítico</th><th>Status</th><th></th></tr></thead>
      <tbody>${crit.filter((c) => c.product === g).map((c) => html`<tr style="${c.active ? '' : 'opacity:.5'}"><td><span class="chip outline">${c.code}</span></td><td><b>${c.name}</b><div class="tiny muted">${c.description || ''}</div></td>
        <td class="right num">${String(c.weight).replace('.', ',')}</td><td>${c.critical ? html`<span class="chip bad">${icon('alert')}Sim</span>` : html`<span class="muted small">Não</span>`}</td>
        <td>${c.active ? html`<span class="chip ok">Ativo</span>` : html`<span class="chip">Inativo</span>`}</td><td class="right"><button class="btn-icon" data-e="${c.id}" aria-label="Editar">${icon('edit')}</button></td></tr>`)}</tbody></table></div></div></div>`)}`);
  const reload = async () => { await ctx.refreshMeta(); render(el, _p, ctx); };
  $('#cr-new').onclick = () => edit(null, reload);
  $$('[data-e]').forEach((b) => b.addEventListener('click', () => edit(crit.find((c) => c.id === Number(b.dataset.e)), reload)));
}

function edit(c, done) {
  modal({
    title: c ? `Editar critério ${c.code}` : 'Novo critério',
    body: html`<form id="cr-form">
      <div class="grid g-3"><div class="field"><label for="cr-p">Produto</label><select class="select" id="cr-p" name="product">${GROUPS.map(([g, l]) => html`<option value="${g}" ${c?.product === g ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div class="field"><label for="cr-c">Código</label><input class="input" id="cr-c" name="code" maxlength="8" required value="${c?.code || ''}" style="text-transform:uppercase"></div>
        <div class="field"><label for="cr-w">Peso</label><input class="input" id="cr-w" name="weight" type="number" min="0.5" max="10" step="0.5" value="${c?.weight ?? 1}"></div></div>
      <div class="field"><label for="cr-n">Nome</label><input class="input" id="cr-n" name="name" required value="${c?.name || ''}"></div>
      <div class="field"><label for="cr-d">Definição (usada pela IA e exibida ao analista)</label><textarea class="textarea" id="cr-d" name="description">${c?.description || ''}</textarea></div>
      <div class="row"><label class="switch"><input type="checkbox" name="critical" ${c?.critical ? 'checked' : ''}> Critério crítico (NC zera a nota)</label>
        ${c ? html`<label class="switch"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Ativo</label>` : ''}</div>
    </form>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="cr-ok">Salvar</button>`,
    onMount: (m, close) => {
      $('#cr-ok', m).onclick = async (e) => {
        const f = $('#cr-form', m); if (!f.reportValidity()) return;
        const body = { product: f.product.value, code: f.code.value, weight: Number(f.weight.value), name: f.name.value, description: f.description.value, critical: f.critical.checked, active: c ? f.active.checked : true };
        busy(e.currentTarget, true);
        try { c ? await api.put(`/criteria/${c.id}`, body) : await api.post('/criteria', body); toast('Critério salvo.'); close(); done(); }
        catch (ex) { toast(ex.message, 'err'); busy(e.currentTarget, false); }
      };
    },
  });
}
