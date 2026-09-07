# AGENTS.md — craft-catalog-engine (motor + Worker de menús edge)

> Guía para agentes (Claude / Codex / opencode / deepseek). Responder y documentar en **español**.

Este repo es el **motor compartido** de los menús digitales de Craft Systems y el **Worker edge**
que los sirve. NO es un menú de cliente; es la infraestructura que sirve a TODOS.

## Estructura
- `v1/catalog.js` + `v1/catalog.css` — **el motor** (carrito, variantes, modal, slider, checkout).
  Servido en `https://craft-catalog-engine.pages.dev/v1/` (Cloudflare Pages, cuenta principal).
  Lo consumen TODOS los menús (edge y los ~21 legacy en Pages). **Un cambio aquí afecta a todos.**
- `worker/` — el **Worker `craft-menus`** (Cloudflare Workers). Sirve todos los menús edge por
  hostname `{slug}.craft-systems.com`, con SSR anti-FOUC. `worker/src/index.js` (fetch handler),
  `worker/src/lib.js` (lógica pura: resolveSlug, render, escape), `worker/template.html` (shell),
  `worker/wrangler.toml`.

## Arquitectura edge (contexto)
- **KV** (namespace MENUS): `{slug}:config`, `{slug}:productos`, `{slug}:theme`, `domain:{host}`. Los escribe **craft-crm** (no este repo).
- **R2** (`media.craft-systems.com`): imágenes. El Worker NO las sirve (las sirve R2 directo, egreso $0).
- **Route por menú** `{slug}.craft-systems.com/*` → creado por el onboarding de craft-crm vía API.
  **NUNCA pongas un wildcard `*.craft-systems.com/*`** en `wrangler.toml`: taparía `media.craft-systems.com`
  (custom domain de R2) y rutearía toda la media por el Worker (rompe costos). Routes = por menú, vía API.

## Config-driven (motor + Worker leen de `config.json`)
El motor y el Worker renderizan desde config, sin CSS por cliente: `store_name, site_title, hero_title,
theme_primary, theme_accent, fonts` (URL Google Fonts), `brand_sub, hero_kicker, hero_divider,
search_placeholder, logo, favicon, whatsapp_number, categories, hours, location, packaging, cross_sell`.
El motor (`catalog.js`) los aplica en runtime (edge vía `window.__CONFIG__`, legacy vía `fetch config.json`);
el Worker los inyecta por SSR (`template.html` + `lib.js render()`). Si agregás un campo nuevo,
tócalo en AMBOS (motor + Worker) para que funcione en edge y legacy.

## Contrato del motor — NO romper
No cambies los IDs/clases del shell que `catalog.js` usa: `brandLogo, brandName, heroTitle, heroNotice,
searchInput, catStrip, catalog, footerText, sliderTrack, sliderPrev, sliderNext, sliderDots,
modalOverlay, modalClose, modalDetail, cartOverlay, cartDrawer, cartClose, cartItems, cartTotal,
btnCheckout, cartPeek, peekCount, peekTotal, navBadge, toast, legalOverlay` y clases `.card .card-*
.btn-add .qty-control .variant-* .slider-* .cat-chip .cat-header .grid .cart-item .modal-detail
.hero-* .brand-*`. `template.html` (Worker) y el shell legacy deben mantener esos IDs.

## Deploy
- Motor (`v1/`): `git push` → Cloudflare Pages auto-deploy (integración Git, sin workflow). Verifica en `craft-catalog-engine.pages.dev/v1/`.
- Worker: `cd worker && CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler@latest deploy`.
- Tests: `node --test v1/*.test.cjs` (motor) y `node --test worker/lib.test.mjs` (Worker).

## Producir/corregir menús
No se hace desde este repo. Onboarding + correcciones = endpoints superadmin de **craft-crm**
(`POST /catalog/onboard`, `PUT /catalog/menu/theme`, `PATCH /catalog/menu/config`).
Guía completa: `~/proyectos/pages/plantillas/menus-digitales/PIPELINE-MENUS.md`.
Contexto global del cluster: `~/proyectos/CLAUDE.md` y `~/proyectos/dev/craft-crm/CLAUDE.md`.

## Reglas
- Storage = **Cloudflare R2** (`media.craft-systems.com`). MinIO quedó legacy. **Nada nuevo escribe a MinIO.**
- Un cambio en `v1/` impacta a los ~21 clientes legacy también → probá retrocompatibilidad (que siga
  funcionando con `fetch config.json` cuando no hay `window.__CONFIG__`).
- GOTCHA shell zsh: `$SLUG:config` mangla la key KV (`{slug}onfig`); usá la key completa hardcodeada.
