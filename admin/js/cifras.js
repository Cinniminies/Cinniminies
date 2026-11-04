// Formatos de plata y de variación que comparten /admin (lo importa util.js como módulo ES) y api/ (los avisos push
// de api/_lib/push.js, en CommonJS). Un solo archivo que sirve en los dos lados, así el aviso del celular y la pantalla
// muestran lo mismo: queda en globalThis.cifras y, en Node, también en module.exports.
(() => {
  // "$1.234", "$1.234,50", "−$80". El signo se decide después de redondear: -0,001 es "$0", no "−$0".
  function pesos(n) {
    if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
    const centavos = Math.round(Math.abs(Number(n)) * 100);
    const entero = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const resto = centavos % 100;
    return (Number(n) < 0 && centavos ? '−' : '') + '$' + entero + (resto ? ',' + String(resto).padStart(2, '0') : '');
  }

  // Cambio relativo contra el período anterior (0.12 = 12 %), o null si no hay con qué comparar.
  function cambio(actual, anterior) {
    if (!anterior || actual == null) return null;
    const c = (actual - anterior) / Math.abs(anterior);
    return Number.isFinite(c) ? c : null;
  }

  // "sube 12 % vs agosto", "baja 3,5 % vs agosto" o "igual que agosto"; null si no hay con qué comparar. Con un
  // decimal por debajo del 10 %, mirando el número ya redondeado: 9,96 % es "10 %", no "10,0 %".
  function textoVariacion(actual, anterior, contra) {
    const c = cambio(actual, anterior);
    if (c == null) return null;
    const pct = Math.abs(c * 100);
    if (pct < 0.05) return `igual que ${contra}`;
    const unDecimal = Math.round(pct * 10) / 10;
    return `${c > 0 ? 'sube' : 'baja'} ${unDecimal < 10 ? unDecimal.toFixed(1).replace('.', ',') : Math.round(pct)} % vs ${contra}`;
  }

  const cifras = { pesos, cambio, textoVariacion };
  globalThis.cifras = cifras;
  if (typeof module === 'object' && module.exports) module.exports = cifras;
})();
