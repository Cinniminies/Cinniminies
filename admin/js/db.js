import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Devuelve los datos de una consulta o tira un Error con el mensaje de la base
// (los `raise exception` de las funciones ya vienen en castellano).
export async function q(consulta) {
  const { data, error } = await consulta;
  if (error) throw new Error(error.message || 'Error de conexión');
  return data;
}

export const rpc = (fn, args) => q(sb.rpc(fn, args));
