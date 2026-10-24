import { api, download } from '../api.js';
import { html, icon, $, toast, busy, confirmDialog } from '../ui.js';

const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 — máxima qualidade (recomendado)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — rápido e econômico'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 — volume alto, menor custo'],
];

export async function render(el, _p, ctx) {
  const s = await api.get('/settings');
  if (!ctx.isCurrent()) return;
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Configurações</h2><p>Parâmetros gerais, inteligência artificial, visibilidade e dados.</p></div></div>
    <form id="st-form" class="grid g-2">
      <div class="card card-pad"><h3 style="margin:0 0 14px;font-size:15px">${icon('sparkles')} Inteligência artificial</h3>
        <div class="banner ${s.anthropic_api_key_set ? 'ok' : 'warn'}">${icon(s.anthropic_api_key_set ? 'checkCircle' : 'alert')}<div>${s.anthropic_api_key_set
          ? html`IA ativa · chave ${s.anthropic_api_key_source === 'variavel_ambiente' ? 'definida na variável de ambiente ANTHROPIC_API_KEY do servidor' : html`cadastrada (<code>${s.anthropic_api_key_hint}</code>)`}.`
          : 'Sem chave cadastrada: a análise automática usa a heurística local. Cadastre uma chave da API da Anthropic para análises completas.'}</div></div>
        <div class="field"><label for="st-key">Chave da API da Anthropic</label><input class="input" id="st-key" type="password" autocomplete="off" placeholder="${s.anthropic_api_key_hint ? 'Deixe em branco para manter a atual' : 'sk-ant-...'}" ${s.anthropic_api_key_source === 'variavel_ambiente' ? 'disabled' : ''}>
          <span class="hint">Gerada em console.anthropic.com. Fica guardada só no servidor e nunca aparece de novo na tela. Preferível definir como variável de ambiente no servidor.</span></div>
        ${s.anthropic_api_key_source === 'banco' ? html`<label class="check small mb"><input type="checkbox" id="st-key-rm"> Remover a chave cadastrada</label>` : ''}
        <div class="field"><label for="st-model">Modelo</label><select class="select" id="st-model" name="ai_model">${MODELS.map(([v, l]) => html`<option value="${v}" ${s.ai_model === v ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div class="grid g-2"><div class="field"><label for="st-eff">Profundidade de análise</label><select class="select" id="st-eff" name="ai_effort">${[['medium', 'Padrão'], ['high', 'Alta (recomendado)'], ['xhigh', 'Muito alta']].map(([v, l]) => html`<option value="${v}" ${s.ai_effort === v ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div class="field"><label for="st-thr">Confiança mínima p/ corrigir sozinho</label><select class="select" id="st-thr" name="ai_confidence_threshold">${['0.6', '0.7', '0.8', '0.9'].map((v) => html`<option value="${v}" ${(s.ai_confidence_threshold || '0.7') === v ? 'selected' : ''}>${Number(v) * 100}%</option>`)}</select></div></div>
        <label class="switch"><input type="checkbox" id="st-auto" ${s.ai_auto_apply !== '0' ? 'checked' : ''}> Corrigir automaticamente as divergências com confiança alta</label>
        <p class="tiny muted">Ajustes feitos manualmente por analistas nunca são sobrescritos pela IA. Tudo fica registrado no histórico.</p>
      </div>
      <div class="stack" style="gap:18px">
        <div class="card card-pad"><h3 style="margin:0 0 14px;font-size:15px">${icon('settings')} Geral</h3>
          <div class="field"><label for="st-co">Nome da empresa (capa dos reports)</label><input class="input" id="st-co" name="company_name" value="${s.company_name || ''}"></div>
          <div class="field"><label for="st-ft">Rodapé dos reports (opcional)</label><input class="input" id="st-ft" name="report_footer" value="${s.report_footer || ''}" placeholder="Uso interno · Confidencial"></div>
          <div class="field"><label for="st-sc">Visão da Supervisão</label><select class="select" id="st-sc" name="supervisor_scope"><option value="all" ${s.supervisor_scope !== 'team' ? 'selected' : ''}>Vê todos os operadores</option><option value="team" ${s.supervisor_scope === 'team' ? 'selected' : ''}>Vê apenas os operadores vinculados a ele(a)</option></select>
            <span class="hint">O vínculo é feito no cadastro do operador.</span></div>
        </div>
        <div class="card card-pad"><h3 style="margin:0 0 14px;font-size:15px">${icon('database')} Dados</h3>
          <p class="small t2" style="margin-top:0">Banco em <code>${s.data_dir}</code>. Faça backups periódicos.</p>
          <div class="row"><button type="button" class="btn" id="st-bk">${icon('download')}Baixar backup</button><button type="button" class="btn danger" id="st-demo">${icon('trash')}Remover dados de demonstração</button></div>
        </div>
      </div>
      <div class="span-2 row"><div style="flex:1"></div><button class="btn primary lg" id="st-save">${icon('check')}Salvar configurações</button></div>
    </form>`);

  $('#st-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { company_name: f.company_name.value, report_footer: f.report_footer.value, supervisor_scope: f.supervisor_scope.value, ai_model: f.ai_model.value, ai_effort: f.ai_effort.value, ai_confidence_threshold: f.ai_confidence_threshold.value, ai_auto_apply: $('#st-auto').checked ? '1' : '0' };
    const key = $('#st-key').value.trim();
    if (key) body.anthropic_api_key = key;
    if ($('#st-key-rm')?.checked) body.anthropic_api_key = '';
    busy($('#st-save'), true, 'Salvando');
    try { await api.put('/settings', body); toast('Configurações salvas.'); await ctx.refreshMeta(); ctx.store.company = body.company_name || ctx.store.company; render(el, _p, ctx); }
    catch (ex) { toast(ex.message, 'err'); busy($('#st-save'), false); }
  });
  $('#st-bk').onclick = async (e) => { busy(e.currentTarget, true); try { await download('/admin/backup', `px-monitorias-backup-${new Date().toISOString().slice(0, 10)}.db`); } catch (ex) { toast(ex.message, 'err'); } busy(e.currentTarget, false); };
  $('#st-demo').onclick = async () => {
    if (!(await confirmDialog('Remover dados de demonstração', 'Monitorias, operadores e usuários de exemplo (que nunca fizeram login) serão removidos. Dados reais não são afetados.', { ok: 'Remover', danger: true }))) return;
    await api.post('/admin/clear-demo'); toast('Dados de demonstração removidos.'); await ctx.refreshMeta(); ctx.store.cycle = ''; localStorage.removeItem('px_cycle');
  };
}
