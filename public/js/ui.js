// Utilitários de interface: templates seguros, ícones, toasts, modais e formatação.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));

function interp(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(interp).join('');
  return esc(v);
}
// Template literal com escape automático: html`<b>${nome}</b>`
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += interp(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------- Ícones (traço 2px, 24x24) ----------------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z"/><path d="M3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/><path d="M18 17v1a3 3 0 0 1-3 3h-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/><path d="M5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  msgCheck: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m9 10 2 2 4-4"/>',
  msgClock: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v3l2 1.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6m0-6 6 6"/>',
  half: '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/>',
  minus: '<path d="M5 12h14"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 18v-3m4 3v-6m4 6v-4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  sliders: '<path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6"/>',
  userCog: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4"/><circle cx="18" cy="17" r="3"/><path d="M18 12v2m0 6v2m5-5h-2m-6 0h-2"/>',
  bug: '<path d="m8 2 1.88 1.88M14.12 3.88 16 2"/><path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5m3 8H2m1 8c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4m-.8 4c2.1.1 3.8 1.9 3.8 4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  zoom: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6m4-6v6"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z" fill="currentColor"/>',
  audio: '<path d="M2 10v3m4-7v11m4-14v18m4-13v7m4-10v13m4-8v3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8m8 4H8m2-8H8"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4m0 4h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>',
  arrowUp: '<path d="m5 12 7-7 7 7M12 19V5"/>',
  arrowDown: '<path d="M12 5v14m7-7-7 7-7-7"/>',
  arrowRight: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  rows: '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5m0-1V4a2 2 0 0 0-4 0v2m0 4.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
};
export function icon(name, cls = '') {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`);
}

export const PX_MARK = '<svg viewBox="0 0 920 528" aria-hidden="true"><path fill="#fff" fill-rule="evenodd" d="M547.6,494.9C521.5,491.9 486.1,457.1 491.0,439.2C492.3,434.3 498.1,425.3 505.6,416.5C508.9,412.6 515.1,405.1 519.4,399.8C523.6,394.4 534.5,382.5 543.5,373.3C552.4,364.0 562.6,353.0 566.1,348.7C577.2,335.1 580.0,331.8 590.3,320.0C595.9,313.7 605.5,303.6 611.6,297.5C617.7,291.4 625.3,283.4 628.3,279.5C641.1,263.6 647.3,256.5 662.5,239.9C671.3,230.3 683.9,216.9 690.6,210.0C697.3,203.1 704.7,194.6 707.1,191.0C709.4,187.4 714.6,181.1 718.4,176.9C722.3,172.7 730.7,163.5 737.0,156.4C743.3,149.3 751.2,140.6 754.5,137.0C757.8,133.4 764.1,126.0 768.5,120.5C779.0,107.7 791.0,94.2 804.2,80.4C816.8,67.4 819.0,63.2 815.4,59.6C812.1,56.3 809.9,57.7 793.8,73.7C776.9,90.5 763.2,105.6 752.8,118.7C740.9,133.8 702.2,173.5 690.3,182.7C687.1,185.2 679.7,189.6 673.8,192.6C659.7,199.7 655.3,199.9 643.0,193.9C634.9,190.0 633.5,188.8 600.8,156.2C582.1,137.7 563.4,118.5 559.1,113.5C543.2,95.3 538.2,89.8 522.6,73.1C503.3,52.4 500.6,48.8 500.6,44.2C500.6,40.1 504.6,36.0 508.6,36.0C514.9,36.0 524.8,44.4 537.2,60.0C540.5,64.1 560.6,85.3 581.9,107.0C603.3,128.7 624.3,150.6 628.7,155.5C645.2,174.1 650.4,177.6 661.0,176.8C667.2,176.4 666.8,176.6 684.7,164.6C698.2,155.7 724.8,128.2 746.4,101.1C749.7,97.1 755.8,90.0 760.1,85.5C764.4,80.9 770.0,74.0 772.5,70.0C778.2,61.2 793.3,43.6 797.6,41.0C803.2,37.5 813.9,34.0 819.0,34.0C824.7,34.0 840.7,38.8 849.2,43.1C860.6,48.8 876.2,66.3 880.0,77.4C884.0,89.3 882.1,96.8 872.5,106.0C869.4,109.0 864.1,115.3 860.7,120.0C853.2,130.4 836.4,149.4 816.4,170.0C808.1,178.5 798.7,189.1 795.5,193.5C792.3,197.9 785.4,205.9 780.3,211.3C775.2,216.7 767.7,225.2 763.6,230.3C759.5,235.4 752.7,242.9 748.5,247.0C744.3,251.1 738.1,257.9 734.7,262.0C731.4,266.1 724.7,273.8 720.0,279.0C715.3,284.2 708.3,292.3 704.5,297.0C700.8,301.7 690.2,313.1 681.0,322.5C671.9,331.9 662.2,342.6 659.5,346.5C651.0,358.7 643.5,367.4 624.6,386.7C614.6,397.0 604.5,408.0 602.2,411.0C591.8,424.8 588.2,429.1 580.2,437.5C565.3,453.0 555.0,465.0 555.0,466.9C555.0,470.1 558.5,472.3 562.2,471.5C565.9,470.7 577.6,459.2 590.7,443.5C599.0,433.5 622.6,408.0 651.4,377.8C669.3,359.0 687.7,342.8 695.9,338.5C701.7,335.5 713.1,332.0 717.0,332.0C721.8,332.0 737.5,337.4 742.2,340.6C747.7,344.4 770.6,368.3 783.4,383.5C789.4,390.7 797.8,400.1 801.9,404.5C806.1,408.9 814.7,418.3 821.0,425.3C827.3,432.3 834.2,439.4 836.2,441.0C841.4,445.2 868.2,474.5 870.2,478.3C875.0,486.8 869.2,496.9 861.4,493.9C856.5,492.1 832.5,468.0 798.0,430.4C790.0,421.7 780.3,411.4 776.5,407.6C772.6,403.7 765.6,396.0 761.0,390.5C756.3,385.0 750.7,379.0 748.5,377.0C746.3,375.1 742.8,371.5 740.5,369.0C729.3,356.4 725.5,353.3 720.0,352.1C711.0,350.2 707.3,351.3 696.0,359.9C691.9,363.1 686.9,366.6 685.0,367.8C680.6,370.5 639.5,412.0 631.5,421.9C628.2,426.0 623.2,432.3 620.4,435.9C617.6,439.5 610.1,448.2 603.7,455.2C597.3,462.2 590.9,470.2 589.5,473.0C583.6,484.7 565.3,497.0 555.6,495.9C555.0,495.8 551.4,495.4 547.6,494.9Z M92.0,494.0C84.5,492.8 68.9,485.9 62.4,481.0C52.9,473.9 43.9,461.6 40.1,450.9C39.1,447.9 36.9,442.8 35.4,439.5L32.5,433.5L32.5,349.5C32.5,303.3 32.8,231.3 33.1,189.5L33.6,113.5L38.6,99.0C49.4,67.2 66.5,49.8 97.7,38.8L109.5,34.6L201.0,33.7C313.1,32.5 339.4,33.2 354.0,37.8C359.2,39.4 366.0,41.0 369.1,41.4C374.3,41.9 377.6,43.2 393.0,50.4C411.1,58.8 433.5,75.1 444.2,87.6C464.5,111.2 466.1,113.4 472.5,126.5C482.8,147.5 486.0,155.5 487.5,163.7C488.2,168.0 489.7,174.4 490.7,178.0C492.1,183.4 492.5,188.5 492.5,208.0C492.5,231.0 492.4,231.9 489.1,247.0C485.4,264.1 482.0,272.7 471.4,292.3C463.1,307.5 462.7,308.1 451.0,321.5C438.5,335.9 438.1,336.3 422.7,347.8C401.0,364.1 385.5,370.8 356.5,376.4C352.1,377.3 346.0,378.6 343.0,379.4C333.7,381.9 314.6,383.0 280.3,383.0C257.0,383.1 246.7,383.4 244.8,384.3C243.3,385.0 220.3,407.1 193.8,433.6C147.4,479.8 140.6,485.9 133.5,487.6C131.8,488.0 127.3,489.7 123.5,491.3C115.7,494.6 102.8,495.7 92.0,494.0Z M124.6,392.2C126.8,390.6 146.8,371.0 169.2,348.7C195.8,322.0 211.0,307.5 213.3,306.5C216.4,305.2 225.0,305.0 267.7,304.9C334.3,304.8 339.7,304.5 352.0,299.7C357.2,297.6 363.3,295.0 365.5,294.0C371.2,291.1 386.7,279.0 392.1,273.0C398.0,266.5 406.8,250.2 411.6,237.0C415.1,227.0 415.3,225.8 415.8,211.2C416.3,194.1 415.9,192.1 409.9,175.5C403.2,157.4 399.0,150.2 389.6,141.2C378.8,130.9 368.6,123.7 359.1,120.1C354.9,118.5 348.8,115.9 345.5,114.3L339.5,111.5L233.5,111.5C175.2,111.5 125.8,111.9 123.7,112.3C118.9,113.3 113.5,118.1 111.9,122.8C110.0,128.3 109.9,381.6 111.8,387.7C114.0,395.2 118.4,396.7 124.6,392.2Z"/></svg>';
export const pxLogo = (size = 40) => raw(`<span class="px-logo" style="width:${size}px;height:${size}px" role="img" aria-label="PX">${PX_MARK}</span>`);

// ---------------- Formatação ----------------
// Carteiras PAN (dashboards importados) + Refinanciamento/Entrega Amigável lançados à mão
export const PRODUCTS = ['VEICULOS', 'CARTOES', 'CONSIGNADO', 'REFIN', 'ENTREGA'];
export const PRODUCT = { VEICULOS: 'Veículos', CARTOES: 'Cartões', CONSIGNADO: 'Consignado', REFIN: 'Refinanciamento', ENTREGA: 'Entrega Amigável' };
export const PRODUCT_SHORT = { VEICULOS: 'Veículos', CARTOES: 'Cartões', CONSIGNADO: 'Consignado', REFIN: 'Refin', ENTREGA: 'Entrega' };
export const SEGMENT = { CLEAN_CURTO: 'Clean Curto', CLEAN_LONGO: 'Clean Longo', PUBLICO: 'Público', PRIVADO: 'Privado', none: 'Segmento a definir' };
export const SEGMENTS_OF = { CARTOES: ['CLEAN_CURTO', 'CLEAN_LONGO'], CONSIGNADO: ['PUBLICO', 'PRIVADO'] };
export const CRITERIA_GROUP = { VEICULOS: 'Veículos', SEM_GARANTIA: 'Sem Garantia (Cartões e Consignado)', CARTOES: 'Só Cartões', CONSIGNADO: 'Só Consignado', AMBOS: 'Refin e Entrega', REFIN: 'Refinanciamento', ENTREGA: 'Entrega Amigável', AGV: 'AGV (campanhas com assistente virtual)' };
// No roteiro Sem Garantia a "nota original" é a 1ª leitura da transcrição, não o speech
export const origLabel = (e) => (e?.source === 'dash_sem_garantia' ? '1ª leitura' : e?.details?.agv_source?.kind === 'dash_agv_esf' || e?.source === 'dash_agv_esf' ? 'Leitura' : 'Speech');
export const productLabel = (p, seg) => `${PRODUCT[p] || p}${SEGMENTS_OF[p] ? ` · ${SEGMENT[seg || 'none']}` : ''}`;
export const ALERT = {
  sigilo: ['Sigilo', 'Dados passados a outra pessoa'], conduta: ['Conduta', 'Conduta inadequada com o cliente'], oferta_perdida: ['Oferta perdida', 'Cliente apto a E.A./refin sem a oferta'],
  postura: ['Postura', 'Postura inadequada (speech)'], sem_proposta: ['Sem proposta', 'Negociação sem nenhuma proposta'], audio_ruim: ['Áudio ruim', 'Sem condições de avaliação'], sem_speech: ['Sem speech', 'Speech não devolveu respostas'],
};
export const RESULT = { C: 'Conforme', P: 'Parcial', NC: 'Não conforme', NA: 'N/A' };
export const RESULT_ICON = { C: 'checkCircle', P: 'half', NC: 'xCircle', NA: 'minus' };
export const STATUS = { pendente: 'Pendente de revisão', revisada: 'Revisada', feedback_aplicado: 'Feedback aplicado' };
export const ROLE = { admin: 'Administrador', qualidade: 'Qualidade', supervisor: 'Supervisão' };
export const CONTEST = { aberta: ['Contestação aberta', 'warn'], aceita: ['Contestação aceita', 'ok'], recusada: ['Contestação recusada', 'bad'], cancelada: ['Contestação cancelada', ''] };

export const fmtScore = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtPct = (v) => (v == null ? '—' : `${fmtScore(v)}%`);
export const fmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
// Aceita 'AAAA-MM-DD' (data pura), ISO com fuso (Supabase) ou 'AAAA-MM-DD HH:MM:SS' em UTC
export function parseDate(s) {
  const str = String(s);
  if (str.length <= 10) return new Date(str + 'T12:00:00');
  const iso = str.replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
}
export function fmtDate(s, withTime = false) {
  if (!s) return '—';
  const d = parseDate(s);
  if (Number.isNaN(d.getTime())) return s;
  return withTime
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtRel(s) {
  if (!s) return '';
  const d = parseDate(s);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
  return fmtDate(s);
}
export const fmtDur = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
export function band(score) {
  if (score == null) return 'sem_nota';
  if (score >= 90) return 'excelente';
  if (score >= 75) return 'bom';
  if (score >= 60) return 'atencao';
  return 'critico';
}
export const BAND_LABEL = { excelente: 'Excelente', bom: 'Bom', atencao: 'Atenção', critico: 'Crítico', sem_nota: 'Sem nota' };
export function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
const AV_COLORS = ['#7c6cff', '#3987e5', '#199e70', '#d95926', '#d55181', '#9085e9', '#c98500', '#22a2c3'];
export function avatar(name, cls = '') {
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return html`<span class="avatar ${cls}" style="background:${raw(AV_COLORS[h % AV_COLORS.length])}">${initials(name)}</span>`;
}
export function resChip(r) {
  if (!r) return html`<span class="res none">—</span>`;
  return html`<span class="res ${r}">${icon(RESULT_ICON[r])}${RESULT[r]}</span>`;
}
export function productChip(p, seg) {
  return html`<span class="chip p-${String(p || '').toLowerCase()}">${PRODUCT[p] || p}${SEGMENTS_OF[p] ? html`<span class="sg">${SEGMENT[seg || 'none']}</span>` : ''}</span>`;
}
export function deltaTag(v, suffix = '') {
  if (v == null || Number.isNaN(v)) return '';
  const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
  return html`<span class="delta ${cls}">${cls === 'up' ? icon('arrowUp') : cls === 'down' ? icon('arrowDown') : ''}${v > 0 ? '+' : ''}${fmtScore(v)}${suffix}</span>`;
}
export function scoreRing(score, cls = '', sub = '') {
  return html`<div class="score-ring ${cls} band-${band(score)}" style="--v:${score == null ? 0 : score}"><div class="center"><b>${score == null ? '—' : fmtScore(score, score % 1 ? 1 : 0)}</b>${sub ? html`<small>${sub}</small>` : ''}</div></div>`;
}
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
export const userName = (u) => (u ? u.display_name || u.name : '');

// ---------------- Toast ----------------
export function toast(msg, type = 'ok', ms = 3200) {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = String(html`${icon(type === 'err' ? 'alert' : 'checkCircle')}<span>${msg}</span>`);
  box.appendChild(t);
  setTimeout(() => { t.style.transition = '.3s'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 300); }, ms);
}

// ---------------- Modal ----------------
export function modal({ title, body, foot, wide = false, onMount, dismissable = true }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = String(html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-head"><h3>${title}</h3>${dismissable ? html`<button class="btn-icon" data-close aria-label="Fechar">${icon('x')}</button>` : ''}</div>
    <div class="modal-body">${body}</div>
    ${foot ? html`<div class="modal-foot">${foot}</div>` : ''}
  </div>`);
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && dismissable) close(); });
  $$('[data-close]', ov).forEach((b) => b.addEventListener('click', close));
  const m = $('.modal', ov);
  onMount?.(m, close);
  setTimeout(() => $('input:not([type=hidden]), textarea, select', m)?.focus(), 50);
  return { el: m, close };
}

export function confirmDialog(title, text, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const { close } = modal({
      title,
      body: html`<p class="t2" style="margin:0">${text}</p>`,
      foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${ok}</button>`,
      onMount: (m, c) => {
        $('[data-ok]', m).addEventListener('click', () => { done = true; c(); resolve(true); });
        $$('[data-close]', m).forEach((b) => b.addEventListener('click', () => { if (!done) resolve(false); }));
      },
    });
    void close;
  });
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${label ? ` ${esc(label)}` : ''}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(file);
  });
}

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

export function sparkline(values, { w = 220, h = 40, color = 'var(--brand)' } = {}) {
  const v = values.map((x) => (x == null ? null : Number(x)));
  const pts = v.map((x, i) => [i, x]).filter(([, x]) => x != null);
  if (pts.length < 2) return raw(`<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`);
  const min = Math.min(...pts.map((p) => p[1])) - 3, max = Math.max(...pts.map((p) => p[1])) + 3;
  const X = (i) => 4 + (i / Math.max(1, v.length - 1)) * (w - 8);
  const Y = (x) => h - 4 - ((x - min) / Math.max(1, max - min)) * (h - 8);
  const d = pts.map(([i, x], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const area = `${d} L${X(last[0]).toFixed(1)},${h} L${X(pts[0][0]).toFixed(1)},${h} Z`;
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  return raw(`<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="${color}"/></svg>`);
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function emptyState(ic, title, text, action = '') {
  return html`<div class="empty"><div class="ic">${icon(ic)}</div><h4>${title}</h4><p>${text}</p>${action}</div>`;
}

// ---------------- Filtro de seleção múltipla (caixas de seleção) ----------------
// multiSelect devolve o HTML; bindMultiSelect liga o comportamento. A escolha é aplicada ao fechar a lista
// (clicar fora, Esc ou "Aplicar"), para a página não redesenhar a cada marcação.
export function multiSelect({ id, allLabel, noun, options, selected = [], cls = '' }) {
  const sel = new Set(selected.map(String));
  const label = !sel.size ? allLabel : sel.size === 1 ? (options.find(([v]) => String(v) === [...sel][0])?.[1] ?? allLabel) : `${sel.size} ${noun}`;
  return html`<div class="ms ${cls} ${sel.size ? 'on' : ''}" data-ms="${id}" data-all="${allLabel}" data-noun="${noun}">
    <button type="button" class="ms-btn" aria-haspopup="listbox" aria-expanded="false"><span class="ms-lb">${label}</span>${sel.size > 1 ? html`<em class="ms-ct">${sel.size}</em>` : ''}</button>
    <div class="ms-pop" hidden role="listbox" aria-multiselectable="true">
      ${options.length > 7 ? html`<input class="ms-q" type="search" placeholder="Buscar…" aria-label="Buscar">` : ''}
      <div class="ms-acts"><button type="button" data-ms-all>Marcar todos</button><button type="button" data-ms-none>Limpar</button></div>
      <div class="ms-list">${options.map(([v, l, n]) => html`<label class="ms-opt"><input type="checkbox" value="${v}" ${sel.has(String(v)) ? 'checked' : ''}><span>${l}</span>${n != null ? html`<em>${n}</em>` : ''}</label>`)}</div>
      <div class="ms-foot"><button type="button" class="ms-ok">Aplicar</button></div>
    </div></div>`;
}
const msOpen = new Set();
function msClose(box, apply = true) {
  const pop = box.querySelector('.ms-pop');
  if (pop.hidden) return;
  pop.hidden = true; box.classList.remove('open'); box.querySelector('.ms-btn').setAttribute('aria-expanded', 'false');
  msOpen.delete(box);
  const checked = [...box.querySelectorAll('.ms-list input:checked')];
  const vals = checked.map((i) => i.value);
  // O botão mostra a escolha mesmo quando a página não redesenha a barra de filtros
  box.querySelector('.ms-lb').textContent = !vals.length ? box.dataset.all : vals.length === 1 ? checked[0].closest('.ms-opt').querySelector('span').textContent : `${vals.length} ${box.dataset.noun}`;
  box.classList.toggle('on', vals.length > 0);
  box.querySelector('.ms-ct')?.remove();
  if (vals.length > 1) box.querySelector('.ms-btn').insertAdjacentHTML('beforeend', `<em class="ms-ct">${vals.length}</em>`);
  if (apply && vals.join('\u0001') !== box._msStart) box._msChange?.(vals);
}
document.addEventListener('mousedown', (e) => { for (const b of [...msOpen]) if (!b.contains(e.target)) msClose(b); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const b of [...msOpen]) msClose(b); });
export function bindMultiSelect(root, id, onChange) {
  const box = root.querySelector(`[data-ms="${id}"]`);
  if (!box) return;
  box._msChange = onChange;
  const pop = box.querySelector('.ms-pop');
  box.querySelector('.ms-btn').addEventListener('click', () => {
    if (!pop.hidden) return msClose(box);
    for (const b of [...msOpen]) msClose(b);
    box._msStart = [...box.querySelectorAll('.ms-list input:checked')].map((i) => i.value).join('\u0001');
    pop.hidden = false; box.classList.add('open'); box.querySelector('.ms-btn').setAttribute('aria-expanded', 'true'); msOpen.add(box);
    box.querySelector('.ms-q')?.focus();
  });
  box.querySelector('.ms-q')?.addEventListener('input', (e) => {
    const q = e.target.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    box.querySelectorAll('.ms-opt').forEach((o) => { o.hidden = q && !o.textContent.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q); });
  });
  box.querySelector('[data-ms-all]').addEventListener('click', () => box.querySelectorAll('.ms-opt:not([hidden]) input').forEach((i) => { i.checked = true; }));
  box.querySelector('[data-ms-none]').addEventListener('click', () => box.querySelectorAll('.ms-list input').forEach((i) => { i.checked = false; }));
  box.querySelector('.ms-ok').addEventListener('click', () => msClose(box));
}
