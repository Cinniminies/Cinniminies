// Avisos push de pedidos nuevos en este celular o compu (fase 2 · 2.1). La suscripción se guarda en
// push_suscripciones y /api/pedidos manda el aviso. El service worker (sw.js) lo muestra.
import { sb, q } from './db.js';
import { VAPID_PUBLIC_KEY } from './config.js';

const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'ok' | 'instalar' (iPhone en Safari: solo funciona con la app en la pantalla de inicio) | 'no'
export function soporte() {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok';
  return esIOS() && !instalada() ? 'instalar' : 'no';
}

async function suscripcionActual() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function activos() {
  if (soporte() !== 'ok' || Notification.permission !== 'granted') return false;
  return !!(await suscripcionActual());
}

// Se llama directo desde el toque (iOS pide el permiso solo así).
export async function activar() {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    throw new Error(permiso === 'denied'
      ? 'Los avisos están bloqueados para esta app. Habilitalos en los ajustes del navegador o del celular.'
      : 'No se activaron los avisos.');
  }
  const reg = await navigator.serviceWorker.ready;
  let sub;
  try {
    sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    });
  } catch (e) {
    // Brave (y algunos Chromium) traen apagado el servicio de push de Google: "push service error".
    if (/push service/i.test(e.message)) {
      throw new Error(navigator.brave
        ? 'Brave tiene apagados los avisos push: activá "Usar los servicios de Google para mensajes push" en Configuración → Privacidad y seguridad, y probá de nuevo.'
        : 'El navegador no pudo conectarse al servicio de avisos. Probá con Chrome, Edge, Firefox o Safari.');
    }
    throw e;
  }
  const { endpoint, keys } = sub.toJSON();
  const { data: { user } } = await sb.auth.getUser();
  await q(sb.from('push_suscripciones').upsert(
    { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, ultimo_error: null },
    { onConflict: 'user_id,endpoint' }));
}

export async function desactivar() {
  const sub = await suscripcionActual();
  if (!sub) return;
  await q(sb.from('push_suscripciones').delete().eq('endpoint', sub.endpoint));
  await sub.unsubscribe();
}
