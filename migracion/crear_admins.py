#!/usr/bin/env python3
"""Da de alta a los usuarios que pueden entrar a /admin.

Uso:
    python3 migracion/crear_admins.py "Pia=pia@ejemplo.com" "Lucio=lucio@ejemplo.com"

Para cada email: si el usuario no existe en Supabase Auth, le manda una invitación por mail
(con el link para entrar), y lo agrega a `usuarios_admin`. Se puede correr varias veces.
Lee SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de `.env.local`. Los emails no se guardan en el repo.
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from importar import cargar_env  # noqa: E402


def llamar(url, clave, metodo, ruta, cuerpo=None, extra=None):
    pedido = urllib.request.Request(
        url + ruta, method=metodo, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={"apikey": clave, "Authorization": f"Bearer {clave}",
                 "Content-Type": "application/json", **(extra or {})})
    try:
        with urllib.request.urlopen(pedido, timeout=30) as r:
            texto = r.read().decode()
            return json.loads(texto) if texto else None
    except urllib.error.HTTPError as e:
        sys.exit(f"Error de Supabase en {metodo} {ruta} ({e.code}): {e.read().decode()}")


def main():
    if len(sys.argv) < 2 or not all("=" in a and "@" in a for a in sys.argv[1:]):
        sys.exit(__doc__)
    env = cargar_env()
    url, clave = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not clave:
        sys.exit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local")

    existentes = {u["email"].lower(): u["id"]
                  for u in llamar(url, clave, "GET", "/auth/v1/admin/users?per_page=1000")["users"]
                  if u.get("email")}
    for arg in sys.argv[1:]:
        nombre, email = (x.strip() for x in arg.split("=", 1))
        user_id = existentes.get(email.lower())
        if user_id:
            print(f"{nombre}: ya existía en Auth")
        else:
            user_id = llamar(url, clave, "POST", "/auth/v1/invite", {"email": email})["id"]
            print(f"{nombre}: invitación enviada a su mail")
        llamar(url, clave, "POST", "/rest/v1/usuarios_admin?on_conflict=user_id",
               {"user_id": user_id, "nombre": nombre},
               {"Prefer": "resolution=merge-duplicates,return=minimal"})
        print(f"{nombre}: es admin")


if __name__ == "__main__":
    main()
