# Web Transportadoras + Sistema de Envios

La pagina principal `/` muestra el directorio de transportadoras.
El sistema operativo esta en `/sistema/login.html`.

## Puesta en marcha

El sistema vive en **https://androidpc.tech** y usa **PostgreSQL** como base de datos (ya no JSON en disco).

1. Copia `.env.example` a `.env` y completa `SESSION_SECRET`, `POSTGRES_PASSWORD`/`DATABASE_URL` y las credenciales SMTP.
2. `docker compose up -d` levanta Postgres (`postgres:16-alpine`, con volumen `pgdata`) y la app, en ese orden (`depends_on: service_healthy`).
3. En el primer arranque, `db.js` crea el esquema y, si las tablas están vacías, migra automáticamente los usuarios/transportadoras/envíos que hubiera en `data/*.json` (compatibilidad con instalaciones anteriores). Esos JSON quedan como respaldo histórico; la app ya no los usa para leer/escribir.
4. Detrás de un reverse proxy (Nginx/Traefik/Caddy) que termine TLS para `androidpc.tech`, la cookie de sesión se marca `secure` automáticamente en `NODE_ENV=production`, así que el proxy debe reenviar `X-Forwarded-*` (la app ya hace `trust proxy`).

Usuarios iniciales con PIN `123456`:
- kamil
- soledad
- dell
- mikela
- benjamin
- rodrigo
- Kevin

El modo al volante esta habilitado solamente para `Kevin`.

## Corrección de impresión v4

La plantilla de impresión fue limpiada para evitar textos duplicados. El nombre, teléfono y ciudad se renderizan una sola vez, con ajuste automático de tamaño y máximo de dos líneas para el nombre.


## Ajuste v6 de impresión

- El teléfono usa la misma familia tipográfica del nombre.
- El teléfono se centra automáticamente en el espacio disponible junto a `TELEFONO:`.
- La ciudad o departamento se mantiene centrada sobre `FRAGIL!!!!`.
- Los cambios aplican a vista previa, PNG, PDF e impresión directa.
