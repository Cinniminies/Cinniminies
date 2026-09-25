import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // Flujo "implicit" a propósito: el link del mail puede abrirse en otro navegador (en iPhone, Safari
  // en vez de la app instalada) y PKCE solo funciona en el mismo navegador que lo pidió.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

// Devuelve los datos de una consulta o tira un Error con el mensaje de la base
// (los `raise exception` de las funciones ya vienen en castellano).
export async function q(consulta) {
  const { data, error } = await consulta;
  if (error) throw new Error(error.message || 'Error de conexión');
  return data;
}

export const rpc = (fn, args) => q(sb.rpc(fn, args));

// Cantidad de filas de una tabla que cumplen un filtro, sin traerlas: contar('tandas', (c) => c.eq('sabor_id', id)).
export async function contar(tabla, filtro = (c) => c) {
  const { count, error } = await filtro(sb.from(tabla).select('*', { count: 'exact', head: true }));
  if (error) throw new Error(error.message);
  return count || 0;
}
