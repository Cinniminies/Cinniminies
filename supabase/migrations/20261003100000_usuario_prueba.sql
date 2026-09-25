-- Usuario de prueba fijo para probar /admin en local (lo crea migracion/usuario_prueba.py).
-- La marca sirve para distinguirlo de las cuentas de los dueños y mostrar "Modo prueba" en /admin.
alter table usuarios_admin add column es_prueba boolean not null default false;
