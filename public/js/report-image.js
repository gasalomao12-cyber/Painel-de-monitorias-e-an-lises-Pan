// Anexar um report em imagem: a IA da plataforma lê a imagem, a analista confere a prévia e guarda.
// O report vai para Análises da carteira, com a imagem original para consulta.
import { api } from './api.js';
import { html, icon, $, toast, modal, busy } from './ui.js';
import { CARTEIRA_INFO, viewCarteira, userCarteiras } from './carteira.js';
import { imageReportBody, IMAGE_MODELS, imageHtml } from './report-views.js';

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
export const isImageFile = (f) => /^image\/(png|jpe?g|webp|gif)$/.test(f?.type || '') || /\.(png|jpe?g|webp)$/i.test(f?.name || '');

// Até 2576 px no lado maior (o que a IA lê sem reduzir) e até ~4,5 MB em base64
async function prepare(file) {
  if (!isImageFile(file)) throw new Error('Envie a imagem do report em PNG, JPG ou WebP.');
  if (file.size > 30 * 1024 * 1024) throw new Error('A imagem passa de 30 MB. Salve o report de novo em tamanho menor.');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('Não consegui abrir esta imagem. Salve o report de novo em PNG ou JPG.'); }
  const k = Math.min(1, 2576 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  for (const q of [0.92, 0.82, 0.7]) {
    let url = cv.toDataURL('image/webp', q);
    let type = 'image/webp';
    if (!url.startsWith('data:image/webp')) { url = cv.toDataURL('image/jpeg', q); type = 'image/jpeg'; }
    if (url.length < 4_500_000) return { url, type, w: cv.width, h: cv.height };
  }
  throw new Error('A imagem é grande demais mesmo comprimida. Recorte o report em partes.');
}

export async function openImageReport(ctx, file) {
  const user = ctx.store.user;
  const own = userCarteiras(user);
  let img = null, read = null;
  const { close } = modal({
    title: 'Report em imagem', wide: true, cls: 'rp-modal',
    body: html`<div id="ri-body"><div class="ri-wait"><span class="spinner"></span><div><b>Preparando a imagem…</b><p class="small t2">${file.name}</p></div></div></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="ri-save" disabled>${icon('check')}Guardar o report</button>`,
  });
  const body = () => document.querySelector('.rp-modal #ri-body');
  const save = () => document.querySelector('.rp-modal #ri-save');
  try {
    img = await prepare(file);
    if (!body()) return;
    body().innerHTML = String(html`<div class="ri-wait"><img src="${img.url}" alt="" class="ri-thumb"><div><span class="spinner"></span> <b>Lendo o report com a IA…</b>
      <p class="small t2">A plataforma identifica o modelo e transcreve os números. Leva de 30 segundos a 2 minutos.</p></div></div>`);
    read = await api.post('/reports/read-image', { image: img.url.split(',')[1], media_type: img.type, file_name: file.name });
  } catch (ex) {
    if (!body()) return;
    body().innerHTML = String(html`<div class="banner warn">${icon('alert')}<div><b>Não foi possível ler o report</b><p class="small" style="margin:4px 0 0">${ex.message}</p></div></div>`);
    return;
  }
  if (!body()) return;
  const chosen = read.carteira && own.includes(read.carteira) ? read.carteira : viewCarteira(user) || own[0];
  body().innerHTML = String(html`
    <div class="banner info mb">${icon('sparkles')}<div><b>${IMAGE_MODELS[read.model]}</b> reconhecido${read.carteira ? ` · carteira ${CARTEIRA_INFO[read.carteira]?.label || read.carteira}` : ''}. Confira os números com a imagem antes de guardar.</div></div>
    <div class="grid g-3 mb">
      <div class="field"><label for="ri-title">Título</label><input class="input" id="ri-title" value="${read.title}" maxlength="200"></div>
      <div class="field"><label for="ri-period">Período</label><input class="input" id="ri-period" value="${read.period}" maxlength="80"></div>
      <div class="field"><label for="ri-cart">Carteira</label><select class="select" id="ri-cart" ${own.length > 1 ? '' : 'disabled'}>${own.map((c) => html`<option value="${c}" ${c === chosen ? 'selected' : ''}>${CARTEIRA_INFO[c].label}</option>`)}</select>
        <span class="hint">Só quem é dessa carteira vê o report.</span></div>
    </div>
    <div class="ri-split"><div class="ri-prev">${imageReportBody(read.data)}</div>
      <details class="ri-img"><summary>${icon('image')}Imagem enviada</summary><img src="${img.url}" alt="Imagem do report"></details></div>`);
  const btn = save();
  btn.disabled = false;
  btn.onclick = async () => {
    const title = $('#ri-title').value.trim();
    if (!title) { toast('Dê um título para o report.', 'err'); return; }
    busy(btn, true, 'Guardando');
    try {
      const r = await api.post('/reports', { kind: 'relatorio', title, period: $('#ri-period').value.trim(), carteira: $('#ri-cart').value, file_name: file.name, data: read.data, html: imageHtml(title, img.url) });
      toast(r.replaced ? 'Report atualizado em Análises da carteira.' : 'Report guardado em Análises da carteira.');
      close();
      ctx.navigate(`analises/${r.id}`);
    } catch (ex) { toast(ex.message, 'err', 8000); busy(btn, false); }
  };
}

// Liga um <input type=file> e a área de soltar à leitura por imagem
export function bindImageDrop(ctx, input, drop) {
  input.onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openImageReport(ctx, f); };
  if (!drop) return;
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) openImageReport(ctx, f); });
}
