# Sistema de Envios

Sistema Dockerizado con HTML, Bootstrap, JS, Node.js, JSON, firma digital, exportacion PDF y reporte semanal por SMTP.

## Usuarios iniciales

Todos tienen PIN inicial `123456`:

- kamil
- soledad
- dell
- mikela
- benjamin
- rodrigo
- kevin1

Cada usuario puede cambiar su PIN desde la web.

## Instalacion VPS

```bash
cd /var/www/sistema-envios
docker compose down
docker compose pull
docker compose up -d
```

## Persistencia

Los datos se guardan en:

- ./data/envios.json
- ./data/usuarios.json
- ./data/transportadoras.json
- ./uploads

No borres esas carpetas.
