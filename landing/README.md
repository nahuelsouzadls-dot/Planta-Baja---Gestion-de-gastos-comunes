# Planta Baja — Landing

Sitio público (estático) de **Planta Baja**, gestión de edificios de propiedad horizontal en Uruguay.

**En vivo:** https://plantabaja.uy

## Contenido

- `index.html` — landing principal
- `legal.html` — privacidad, datos y cookies (Ley N.° 18.331)
- `fonts/` — Plus Jakarta Sans (self-hosted, sin terceros)
- `robots.txt`, `sitemap.xml` — indexación / SEO

## Deploy

Estático en **Netlify**. Deploy manual:

```sh
npx netlify-cli deploy --prod --dir .
```

(o arrastrar la carpeta en https://app.netlify.com/drop)

## Notas

- Sin backend, sin variables de entorno, sin secretos.
- El formulario de contacto abre el correo del visitante (`mailto`), no procesa datos en un servidor.
