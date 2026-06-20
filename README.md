# Web Transportadoras + Sistema de Envios

La pagina principal `/` muestra el directorio de transportadoras.
El sistema operativo esta en `/sistema/login.html`.

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
