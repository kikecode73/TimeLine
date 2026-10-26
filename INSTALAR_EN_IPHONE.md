# TimeLine como app en iPhone/iPad (PWA)

1. Sube TODO el contenido de esta carpeta a un hosting con HTTPS
   (GitHub Pages, Netlify, Cloudflare Pages, Vercel...). Los service workers
   NO funcionan abriendo el archivo local ni por http.
2. En el iPhone abre la URL en **Safari**.
3. Toca Compartir -> **Agregar a pantalla de inicio** -> Agregar.
4. Abre TimeLine desde el ícono. La primera vez necesita internet; luego funciona offline.

Notas
- Los datos se guardan en el almacenamiento local de la app (localStorage). Usa
  "Guardar proyecto" (.json) para respaldos: iOS puede borrar datos de sitios que no se usan por semanas.
- Exportar Excel/PDF/PPT abre la hoja "Compartir" de iOS -> "Guardar en Archivos".
- Al actualizar archivos, cambia CACHE_VERSION en sw.js.
- Las librerías de exportación ya están incluidas en /lib (sin depender de CDNs).
