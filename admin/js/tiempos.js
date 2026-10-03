// Calculadora de tiempo de un horneado (pedido de Lucio, 03/10). Mismos tiempos para todos los sabores,
// en minutos (se guardan en `parametros`). El proceso de cada tanda:
//   preparar la masa (de a `masas` por vez) → leudar → estirar (de a una) → leudar otra vez → horno.
// Una sola persona prepara y estira: cuando una tanda terminó el primer leudado se estira antes de
// seguir preparando (si no, se pasa). El horno entra de a `horno_tandas` por vez.

export const TIEMPOS_DEFECTO = {
  tiempo_preparacion: 25, // por cada preparación (de `masas_por_preparacion` masas)
  masas_por_preparacion: 2,
  tiempo_leudado: 60,
  tiempo_estirado: 18, // por tanda
  tiempo_leudado2: 40,
  tiempo_horno: 20,
  horno_tandas: 1,
};

export function tiemposDe(param = {}) {
  return Object.fromEntries(Object.entries(TIEMPOS_DEFECTO).map(([k, v]) => {
    const n = Number(param[k]);
    return [k, Number.isFinite(n) && n > 0 ? n : v];
  }));
}

// Devuelve { total, tandas: [{ preparacion, leudado, estirado, leudado2, horno }] }, cada etapa como
// [inicio, fin] en minutos desde que se empieza.
export function cronograma(n, t = TIEMPOS_DEFECTO) {
  const tandas = Array.from({ length: n }, () => ({}));
  if (!n) return { total: 0, tandas };
  let persona = 0; // cuándo queda libre quien prepara y estira
  let preparadas = 0;
  const porEstirar = []; // índices preparados y todavía sin estirar, en orden

  for (let estiradas = 0; estiradas < n;) {
    const lista = porEstirar.find((i) => tandas[i].leudado[1] <= persona);
    if (lista !== undefined) {
      porEstirar.splice(porEstirar.indexOf(lista), 1);
      const x = tandas[lista];
      x.estirado = [persona, persona + t.tiempo_estirado];
      x.leudado2 = [x.estirado[1], x.estirado[1] + t.tiempo_leudado2];
      persona = x.estirado[1];
      estiradas++;
    } else if (preparadas < n) {
      const fin = persona + t.tiempo_preparacion;
      for (let k = 0; k < t.masas_por_preparacion && preparadas < n; k++, preparadas++) {
        tandas[preparadas].preparacion = [persona, fin];
        tandas[preparadas].leudado = [fin, fin + t.tiempo_leudado];
        porEstirar.push(preparadas);
      }
      persona = fin;
    } else {
      persona = Math.min(...porEstirar.map((i) => tandas[i].leudado[1]));
    }
  }

  // Horno: por orden de llegada; cada lugar del horno se libera a su tiempo.
  const lugares = Array(t.horno_tandas).fill(0);
  const orden = tandas.map((x, i) => i).sort((a, b) => tandas[a].leudado2[1] - tandas[b].leudado2[1]);
  for (const i of orden) {
    const l = lugares.indexOf(Math.min(...lugares));
    const inicio = Math.max(lugares[l], tandas[i].leudado2[1]);
    tandas[i].horno = [inicio, inicio + t.tiempo_horno];
    lugares[l] = inicio + t.tiempo_horno;
  }
  return { total: Math.max(...tandas.map((x) => x.horno[1])), tandas };
}

// 200 → "3 h 20 min"
export function duracion(min) {
  const m = Math.round(min);
  const hs = Math.floor(m / 60);
  return [hs ? `${hs} h` : null, m % 60 || !hs ? `${m % 60} min` : null].filter(Boolean).join(' ');
}

// "09:30" + 200 → "12:50" (pasada la medianoche sigue contando: "25:10")
export function horaMas(hhmm, min) {
  const [hs, mm] = hhmm.split(':').map(Number);
  const total = hs * 60 + mm + Math.round(min);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
