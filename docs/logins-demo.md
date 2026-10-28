# Logins de prueba (demo local)

Solo para desarrollo local con la demo (`make seed`). **Nunca** usar estas cuentas ni esta contraseña en producción.

Contraseña de todos: **`12345`**

## Administración — `http://localhost:5173/ingresar/administracion`

| Correo | Quién |
|---|---|
| `maria@admin.demo` | María Fernández, Administración Demo |
| `pablo@admin.demo` | Pablo Suárez, Administración Demo |

## Residentes — `http://localhost:5173/ingresar`

| Correo | Quién |
|---|---|
| `maria.garcia@correo.com.uy` | María García, inquilina del apto 102 de Edificio Minas (tiene un comprobante en revisión) |
| `juan.perez@correo.com.uy` | Juan Pérez, propietario del apto 101 de Edificio Minas |
| `pedro.martinez@residentes.demo` | Pedro Martínez, autor de un reclamo de la demo |
| `sofia.lopez@residentes.demo` | Sofía López, autora de un reclamo de la demo |

## Rehacer la demo desde cero

`make seed` exige una contraseña de al menos 10 caracteres; después se pasa a `12345` para probar más rápido:

```bash
make reset-db          # borra la base y los archivos locales
make up
docker compose run --rm web python manage.py migrate
make seed DEMO_PASSWORD=demo-password-123
docker compose run --rm web python manage.py shell -c "
from apps.accounts.models import User
for u in User.objects.all():
    u.set_password('12345'); u.save(update_fields=['password'])
"
```
