// Hook de carga para las pruebas: db.js importa el cliente de Supabase desde la CDN, que Node no puede bajar.
// Ese import se cambia por el cliente falso de _supabase-falso.mjs. Se registra con
// register('./_cargador.mjs', import.meta.url) antes de importar (con import()) lo que usa db.js.
const FALSO = new URL('./_supabase-falso.mjs', import.meta.url).href;

export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js')) return { url: FALSO, shortCircuit: true };
  return siguiente(especificador, contexto);
}
