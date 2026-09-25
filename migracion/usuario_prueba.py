#!/usr/bin/env python3
"""Usuario de prueba fijo para entrar a /admin en local.

Uso:
    python3 migracion/usuario_prueba.py crear    # lo crea (o le cambia la contraseña) y lo guarda en .env.local
    python3 migracion/usuario_prueba.py borrar   # lo saca de usuarios_admin, lo borra y limpia .env.local

`crear` da de alta prueba-admin@cinniminies.test confirmado (sin mandar mail), con una contraseña
aleatoria, lo agrega a `usuarios_admin` como "Prueba" (es_prueba = true) y escribe
PRUEBA_ADMIN_EMAIL y PRUEBA_ADMIN_PASSWORD en `.env.local`. No imprime la contraseña.
Se puede correr varias veces: si ya existe, le pone una contraseña nueva.

Ojo: es admin de la base REAL. Lo que cargue queda en los números: marcar "PRUEBA…" y borrarlo.
"""

import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from crear_admins import llamar  # noqa: E402
from importar import RAIZ, cargar_env  # noqa: E402

EMAIL = "prueba-admin@cinniminies.test"
CLAVES = ("PRUEBA_ADMIN_EMAIL", "PRUEBA_ADMIN_PASSWORD")


def escribir_env(valores):
    """Reemplaza (o agrega) las líneas de CLAVES en .env.local sin tocar el resto."""
    archivo = RAIZ / ".env.local"
    lineas = [l for l in (archivo.read_text().splitlines() if archivo.exists() else [])
              if l.split("=", 1)[0].strip() not in CLAVES]
    lineas += [f"{k}={v}" for k, v in valores.items()]
    archivo.write_text("\n".join(lineas) + "\n")


def buscar(url, clave):
    usuarios = llamar(url, clave, "GET", "/auth/v1/admin/users?per_page=1000")["users"]
    return next((u["id"] for u in usuarios if (u.get("email") or "").lower() == EMAIL), None)


def crear(url, clave):
    contrasena = secrets.token_urlsafe(24)
    user_id = buscar(url, clave)
    if user_id:
        llamar(url, clave, "PUT", f"/auth/v1/admin/users/{user_id}", {"password": contrasena})
        print("Usuario de prueba: ya existía, contraseña nueva")
    else:
        user_id = llamar(url, clave, "POST", "/auth/v1/admin/users",
                         {"email": EMAIL, "password": contrasena, "email_confirm": True})["id"]
        print("Usuario de prueba: creado")
    llamar(url, clave, "POST", "/rest/v1/usuarios_admin?on_conflict=user_id",
           {"user_id": user_id, "nombre": "Prueba", "es_prueba": True},
           {"Prefer": "resolution=merge-duplicates,return=minimal"})
    escribir_env({"PRUEBA_ADMIN_EMAIL": EMAIL, "PRUEBA_ADMIN_PASSWORD": contrasena})
    print("Es admin (es_prueba) y sus datos quedaron en .env.local")


def borrar(url, clave):
    user_id = buscar(url, clave)
    if user_id:
        llamar(url, clave, "DELETE", f"/rest/v1/usuarios_admin?user_id=eq.{user_id}", extra={"Prefer": "return=minimal"})
        llamar(url, clave, "DELETE", f"/auth/v1/admin/users/{user_id}")
        print("Usuario de prueba: borrado")
    else:
        print("Usuario de prueba: no existía")
    escribir_env({})


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("crear", "borrar"):
        sys.exit(__doc__)
    env = cargar_env()
    url, clave = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not clave:
        sys.exit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local")
    (crear if sys.argv[1] == "crear" else borrar)(url, clave)


if __name__ == "__main__":
    main()
