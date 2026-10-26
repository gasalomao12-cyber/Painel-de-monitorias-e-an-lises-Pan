// Roda no <head>, antes da página aparecer: tema salvo + escala da tela.
// Escala automática: a interface inteira cresce ou encolhe conforme a resolução,
// mantendo o mesmo layout (notebook 1366×768 ≈ 89%, Full HD ≈ 110%, telas grandes até 135%).
// O usuário pode fixar outro tamanho pelo botão de zoom (80% a 130%), salvo neste navegador.
(function () {
  var root = document.documentElement;
  try { var t = localStorage.getItem('px_theme'); if (t) root.dataset.theme = t; } catch (e) { /* sem storage */ }

  function autoScale() {
    var w = window.innerWidth, h = window.innerHeight;
    if (w < 900) return 1; // celular/tablet: o layout responsivo já resolve
    var s = Math.min(w / 1440, h / 860);
    return Math.max(0.8, Math.min(1.35, Math.round(s * 100) / 100));
  }
  function pref() { try { return localStorage.getItem('px_zoom') || 'auto'; } catch (e) { return 'auto'; } }

  function apply() {
    var p = pref();
    var z = p === 'auto' ? autoScale() : (window.innerWidth < 900 ? 1 : Number(p) || 1);
    root.style.zoom = z === 1 ? '' : String(z);
    root.style.setProperty('--px-zoom', String(z));
    root.dataset.zoom = p;
    // Menu lateral recolhe sozinho em notebooks (janela com menos de 1600px de largura)
    root.dataset.narrow = window.innerWidth < 1600 ? '1' : '0';
    window.dispatchEvent(new CustomEvent('px:zoom', { detail: { zoom: z, pref: p } }));
  }

  window.PX_ZOOM = {
    get: function () { return Number(root.style.getPropertyValue('--px-zoom')) || 1; },
    pref: pref,
    set: function (v) { try { localStorage.setItem('px_zoom', String(v)); } catch (e) { /* sem storage */ } apply(); },
    apply: apply,
  };
  apply();
  var timer;
  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(apply, 120); });
})();
