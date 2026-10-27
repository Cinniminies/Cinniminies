/* Decoración de Halloween (temporal). Se prende sola hasta el domingo 1/11/2026 a la medianoche de Uruguay.
   Para verla antes o después: ?halloween=1 · para apagarla: ?halloween=0.
   Para sacarla del todo: borrar la carpeta temporada/ y su <script> en index.html. */
(function () {
  var HASTA = Date.parse('2026-11-02T03:00:00Z');
  var pedido = new URLSearchParams(location.search).get('halloween');
  if (pedido === '0' || (pedido !== '1' && Date.now() >= HASTA)) return;

  document.documentElement.classList.add('tema-halloween');
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'temporada/halloween.css';
  document.head.appendChild(css);

  var MURCIELAGO = '<svg viewBox="0 0 100 40"><path d="M50 18C47 12 44 12 43 16C38 10 28 6 14 8C20 12 22 18 20 24C26 22 32 24 34 30C38 26 44 26 46 30C47 28 48 27 50 27C52 27 53 28 54 30C56 26 62 26 66 30C68 24 74 22 80 24C78 18 80 12 86 8C72 6 62 10 57 16C56 12 53 12 50 18Z"/></svg>';

  // Tela de araña en una esquina: rayos y anillos curvos
  function tela() {
    var rayos = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return (i / 6) * Math.PI / 2; });
    var s = rayos.map(function (a) { return '<line x1="0" y1="0" x2="' + (Math.cos(a) * 200).toFixed(1) + '" y2="' + (Math.sin(a) * 200).toFixed(1) + '"/>'; }).join('');
    [50, 90, 130, 170].forEach(function (r) {
      var d = rayos.map(function (a, i) {
        var x = (Math.cos(a) * r).toFixed(1), y = (Math.sin(a) * r).toFixed(1);
        if (!i) return 'M' + x + ' ' + y;
        var m = a - Math.PI / 24;
        return 'Q' + (Math.cos(m) * r * 0.84).toFixed(1) + ' ' + (Math.sin(m) * r * 0.84).toFixed(1) + ' ' + x + ' ' + y;
      }).join('');
      s += '<path d="' + d + '"/>';
    });
    return '<svg viewBox="0 0 200 200">' + s + '</svg>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var deco = document.createElement('div');
    deco.className = 'hw-deco';
    deco.setAttribute('aria-hidden', 'true');
    var bichos = '';
    for (var i = 0; i < 6; i++) bichos += '<span class="hw-murcielago" style="--i:' + i + '">' + MURCIELAGO + '</span>';
    deco.innerHTML =
      '<div class="hw-luna"></div>' + bichos +
      '<div class="hw-tela">' + tela() + '</div>' +
      '<div class="hw-arana"><span class="hw-hilo"></span><svg viewBox="-45 -30 90 80"><g stroke-width="4" fill="none" stroke-linecap="round">' +
      '<path d="M-8 0Q-26 -16 -38 -4M-8 6Q-28 -4 -40 12M-8 12Q-28 12 -38 28M-8 16Q-24 26 -30 42M8 0Q26 -16 38 -4M8 6Q28 -4 40 12M8 12Q28 12 38 28M8 16Q24 26 30 42"/></g>' +
      '<ellipse cx="0" cy="10" rx="13" ry="16"/><circle cx="0" cy="-8" r="9"/><circle class="hw-ojo" cx="-3.5" cy="-9" r="2.4"/><circle class="hw-ojo" cx="3.5" cy="-9" r="2.4"/></svg></div>' +
      '<svg class="hw-rayo" viewBox="0 0 120 400"><path d="M70 0L40 120L70 128L30 260L62 266L20 400"/></svg>' +
      '<div class="hw-destello"></div><div class="hw-niebla"></div>';
    var fondo = hero.querySelector('.hero-bg');
    if (fondo) fondo.after(deco); else hero.prepend(deco);

    var menu = document.querySelector('.menu');
    if (menu) {
      var esquina = document.createElement('div');
      esquina.className = 'hw-tela hw-tela-menu';
      esquina.setAttribute('aria-hidden', 'true');
      esquina.innerHTML = tela();
      menu.appendChild(esquina);
    }
  });
})();
