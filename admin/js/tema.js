// Tema (Más → Cuenta → Tema). Se carga con <script src> sin defer, antes del CSS en el <head> de index.html, para que
// data-tema ya esté al pintar y no parpadee (va en un archivo y no en línea por la CSP de /admin: script-src 'self').
// Queda siempre en "claro" u "oscuro": en Automático sigue al celular y cambia con él. La barra del celular
// (theme-color) toma el --bg del tema cuando el CSS ya cargó. La vista de Más avisa con el evento 'cambio-tema'.
(() => {
  const raiz = document.documentElement;
  const barra = document.querySelector('meta[name="theme-color"]');
  const oscuro = matchMedia('(prefers-color-scheme: dark)');
  const aplicar = () => {
    let elegido = null;
    try { elegido = localStorage.getItem('cinniminies.tema'); } catch { /* sin almacenamiento: Automático */ }
    raiz.dataset.tema = elegido === 'claro' || elegido === 'oscuro' ? elegido : oscuro.matches ? 'oscuro' : 'claro';
  };
  const pintarBarra = () => { barra.content = getComputedStyle(raiz).getPropertyValue('--bg').trim() || barra.content; };
  // Al cambiar de tema, las dos paletas se cruzan en un instante (::view-transition en app.css, que lo apaga con
  // "reducir movimiento") en vez de saltar; sin View Transitions, cambia de golpe.
  const cambiar = () => {
    const pintar = () => { aplicar(); pintarBarra(); };
    if (document.startViewTransition) document.startViewTransition(pintar);
    else pintar();
  };
  aplicar();
  addEventListener('DOMContentLoaded', pintarBarra);
  oscuro.addEventListener('change', cambiar);
  addEventListener('storage', cambiar);
  document.addEventListener('cambio-tema', cambiar);
})();
