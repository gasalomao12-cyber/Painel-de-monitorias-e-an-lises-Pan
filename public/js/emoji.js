// Barra de emojis para os textos do Beedoo: os mais usados à mão e um painel completo por categoria.
// O emoji entra onde está o cursor do texto (ou no lugar do que estiver selecionado).
const QUICK = ['👋', '😊', '😉', '👏', '🙌', '💪', '🚀', '🎯', '✅', '📌', '💡', '🌟', '🔥', '👍', '🤝', '💬', '📊', '📅', '🎧'];
const SETS = [
  ['Rostos', ['😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😍', '🥰', '🤩', '😎', '🤗', '🤔', '😅', '😂', '🥳', '😇', '😌', '😮', '🫡', '🙃', '😬', '🥹', '😏']],
  ['Gestos', ['👋', '👍', '👏', '🙌', '💪', '🤝', '👊', '✌️', '🤞', '👌', '☝️', '👉', '👇', '🫶', '✋', '🙏', '💯', '🫵']],
  ['Trabalho', ['🎧', '📞', '☎️', '💻', '📊', '📈', '📉', '📋', '📝', '📌', '📎', '📅', '⏰', '🗂️', '📣', '💼', '🧭', '🔎', '🗓️', '✉️']],
  ['Conquistas', ['🏆', '🥇', '🏅', '🎯', '🎉', '🥳', '🎊', '👑', '💎', '🌈', '☀️', '🍀', '⭐', '🌟', '✨', '🔥', '🚀', '📈']],
  ['Símbolos', ['✅', '☑️', '✔️', '❌', '⚠️', '❗', '❓', '💡', '💙', '💚', '💛', '🧡', '❤️', '💜', '➡️', '⬅️', '🔔', '🔁', '🆗', '🆕']],
];

export function attachEmoji(ta, { onInsert } = {}) {
  if (!ta || ta.dataset.emoji) return;
  ta.dataset.emoji = '1';
  const bar = document.createElement('div');
  bar.className = 'emo-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Emojis');
  bar.innerHTML = QUICK.map((e) => `<button type="button" class="emo" data-e="${e}" aria-label="Inserir ${e}">${e}</button>`).join('')
    + '<button type="button" class="emo-more" aria-expanded="false">Mais emojis</button>';
  const panel = document.createElement('div');
  panel.className = 'emo-panel';
  panel.hidden = true;
  panel.innerHTML = `<div class="emo-tabs" role="tablist">${SETS.map(([n], i) => `<button type="button" role="tab" data-t="${i}" class="${i ? '' : 'on'}">${n}</button>`).join('')}</div>`
    + SETS.map(([, list], i) => `<div class="emo-grid" data-g="${i}" ${i ? 'hidden' : ''}>${list.map((e) => `<button type="button" class="emo" data-e="${e}" aria-label="Inserir ${e}">${e}</button>`).join('')}</div>`).join('');
  ta.before(bar);
  bar.after(panel);
  const insert = (e) => {
    const s = ta.selectionStart ?? ta.value.length, f = ta.selectionEnd ?? s;
    ta.setRangeText(e, s, f, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    onInsert?.(e);
  };
  const click = (ev) => { const b = ev.target.closest('[data-e]'); if (b) { ev.preventDefault(); insert(b.dataset.e); } };
  bar.addEventListener('mousedown', (ev) => { if (ev.target.closest('button')) ev.preventDefault(); }); // mantém o cursor no texto
  panel.addEventListener('mousedown', (ev) => { if (ev.target.closest('button')) ev.preventDefault(); });
  bar.addEventListener('click', click);
  panel.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-t]');
    if (t) {
      panel.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === t));
      panel.querySelectorAll('[data-g]').forEach((g) => { g.hidden = g.dataset.g !== t.dataset.t; });
      return;
    }
    click(ev);
  });
  const more = bar.querySelector('.emo-more');
  more.addEventListener('click', () => { panel.hidden = !panel.hidden; more.setAttribute('aria-expanded', String(!panel.hidden)); more.classList.toggle('on', !panel.hidden); });
}
