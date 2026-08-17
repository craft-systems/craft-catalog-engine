# craft-catalog-engine

Motor compartido del catálogo digital de Craft (menús, tiendas, catálogos Rappi-style).
**Comportamiento y esqueleto visual** viven aquí una sola vez; cada cliente aporta solo
**datos** (`config.json`, `productos.json`, `media/`) y su **capa visual** (tokens + `theme.css`).

Una feature nueva = editar este repo una vez, taggear una versión, y todos los clientes la
reciben. Ver la deuda que esto resuelve: catálogo forkeado en 5 estructuras distintas.

## Archivos

| Archivo | Qué es |
|---|---|
| `catalog.js` | Comportamiento: carrito, slider, variantes (pills), add-to-cart, checkout WhatsApp, modal, favoritos, buscador, legal. Lee `config.json` y `productos.json` **relativos a la página** (no a este script) → hostearlo cross-origin funciona. |
| `catalog.css` | Esqueleto: grid de cards, modal, drawer del carrito, layout de pills, slider. Todo con `var(--token)`. |

## Integración (index.html del cliente)

```html
<head>
  <link rel="stylesheet" href="https://craft-catalog-engine.pages.dev/v1/catalog.css">
  <style id="craft-vars">:root{ --primary:#E4801C; --accent:#F5B301; }</style> <!-- anti-FOUC, lo genera catalogsync -->
  <link rel="stylesheet" href="./theme.css"> <!-- opcional: CSS bespoke del cliente -->
</head>
<body>
  <!-- ...shell del catálogo (hero, #catalog, modal, drawer)... -->
  <script src="https://craft-catalog-engine.pages.dev/v1/catalog.js" defer></script>
</body>
```

**Hosting:** Cloudflare Pages en la cuenta principal (org GitHub `craft-systems`, integración
nativa Git → push a `master` despliega solo). URL en uso: `craft-catalog-engine.pages.dev`.
**Dominio custom `engine.craftmarketing.agency` PENDIENTE** (aún no resuelve/SSL): agregarlo en el
proyecto Pages → Custom domains; cuando dé 200 en navegador, repuntar todo de pages.dev → el dominio.

**Versionado = carpeta en la ruta** (Cloudflare sirve por ruta, no por tag git). La versión
publicada vive en `/vN/`; para sacar una nueva se crea `/v2/` (NUNCA se edita `/v1/` una vez
que hay clientes en ella) y se repuntan los clientes tras smoke-test. Así un deploy malo nunca
rompe a los que están en `/v1/`, y el nombre versionado evita caché stale.

## Tokens de tema (por cliente, editables desde craft-crm)

Se setean en `config.json` bajo `"theme"` (el motor los aplica como CSS vars al `:root`).
Legacy: `theme_primary` / `theme_accent` a nivel raíz siguen funcionando.

```json
{ "theme": {
    "primary": "#E4801C", "accent": "#F5B301",
    "bg": "#0e0e10", "surface": "#17171b", "surface2": "#1f1f25",
    "text": "#fff", "text2": "#c9c9d2", "text3": "#8a8a95", "border": "#2a2a31",
    "radius": "16px", "font": "DM Sans",
    "card_blur": "0px", "card_alpha": "1"
} }
```

Lo que ningún token cubra (hero custom, composiciones de blur/transparencia, layouts one-off)
va en el `theme.css` del cliente — escrito a mano por el diseñador, **nunca tocado por la automatización**.
Regla de oro: cada archivo tiene un solo escritor (config.theme ← admin · vars inline ← catalogsync · theme.css ← diseñador).

## Data-driven, agnóstico de vertical

Menú, catálogo o tienda de ropa comparten el mismo esqueleto: es un carrito con opciones,
descripción y checkout por WhatsApp. La diferencia (combo, tallas, colores) es solo grupos de
variantes en `productos.json`. Variante con `image` → el slider salta a esa foto al seleccionarla.
