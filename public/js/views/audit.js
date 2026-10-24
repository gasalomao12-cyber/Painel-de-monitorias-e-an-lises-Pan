import { api, qs } from '../api.js';
import { html, raw, $, fmtDate, avatar, emptyState, esc } from '../ui.js';

const LABEL = {
  login: 'Login', senha_alterada: 'Senha alterada', senha_resetada: 'Senha resetada', usuario_criado: 'Usuário criado', usuario_editado: 'Usuário editado',
  atendimento_criado: 'Monitoria registrada', atendimento_excluido: 'Monitoria excluída', analise_ajustada: 'Análise ajustada', analise_validada: 'Análise validada',
  ajustes_revertidos: 'Ajustes revertidos', link_audio_alterado: 'Link de áudio alterado', transcricao_anexada: 'Transcrição anexada', ia_analise: 'Análise por IA',
  ia_erro: 'Erro na IA', ia_sugestoes_aplicadas: 'Sugestões IA aplicadas', feedback_aplicado: 'Feedback aplicado', feedback_editado: 'Feedback editado',
  feedback_removido: 'Feedback removido', importacao: 'Importação de planilha', ciclo_criado: 'Quinzena criada', ciclo_editado: 'Quinzena editada',
  ciclo_excluido: 'Quinzena excluída', criterio_criado: 'Critério criado', criterio_editado: 'Critério editado', configuracoes_alteradas: 'Configurações alteradas',
  operador_criado: 'Operador criado', operador_editado: 'Operador editado', demo_removida: 'Dados de demonstração removidos', backup_baixado: 'Backup baixado', dados_editados: 'Dados editados',
};

export async function render(el, _p, ctx) {
  let action = '';
  el.innerHTML = String(html`<div class="page-head"><div><h2>Auditoria</h2><p>Registro de todas as ações relevantes: quem fez, o quê e quando.</p></div><div class="grow"></div>
    <select class="select sm" id="au-a" style="width:auto"><option value="">Todas as ações</option>${Object.entries(LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div><div id="au-l"></div>`);
  const load = async () => {
    const rows = await api.get(`/audit${qs({ action, limit: 500 })}`);
    if (!ctx.isCurrent()) return;
    $('#au-l', el).innerHTML = rows.length ? String(html`<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr ${r.entity === 'evaluation' && r.entity_id ? raw(`data-ev="${Number(r.entity_id)}" class="click"`) : ''}><td class="nowrap small">${fmtDate(r.created_at, true)}</td><td><div class="who">${avatar(r.user_display || r.user_name || 'Sistema', 'sm')}<b class="small">${r.user_display || r.user_name || 'Sistema'}</b></div></td>
        <td><span class="chip">${LABEL[r.action] || r.action}</span>${r.entity_id ? html` <span class="tiny muted">${r.entity} #${r.entity_id}</span>` : ''}</td>
        <td class="tiny muted" style="max-width:520px;word-break:break-word">${summary(r.detail)}</td></tr>`)}</tbody></table></div></div>`) : String(emptyState('shield', 'Sem registros', 'Nada encontrado para este filtro.'));
    el.querySelectorAll('[data-ev]').forEach((tr) => tr.addEventListener('click', () => ctx.navigate(`atendimentos/${tr.dataset.ev}`)));
  };
  $('#au-a', el).onchange = (e) => { action = e.target.value; load(); };
  await load();
}

function summary(d) {
  if (!d) return '';
  if (d.alteracoes) return d.alteracoes.map((a) => `${a.codigo}: ${a.de || '—'}→${a.para}${a.motivo ? ` (${a.motivo})` : ''}`).join(' · ');
  return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ').slice(0, 300);
}
void esc;
