// Lógica pura del Worker de menús (testeable sin el runtime de CF ni el import de HTML).

export const BASE = "craft-systems.com";
// Subdominios internos: si alguno cayera bajo el wildcard, no es un menú → 404.
export const RESERVED = new Set(["app", "api", "media", "cdn", "www", "mail", "staging", "docs", "blog", "status", "admin", "crm"]);

// resolveSlug: {sub}.craft-systems.com → sub; dominio propio → KV domain:{host}; interno/apex → null.
export async function resolveSlug(host, env) {
  if (host === BASE || host === `www.${BASE}`) return null;
  if (host.endsWith(`.${BASE}`)) {
    const sub = host.slice(0, -(BASE.length + 1));
    if (sub.includes(".") || RESERVED.has(sub)) return null;
    return sub;
  }
  return env.MENUS.get(`domain:${host}`);
}

export function render(tpl, cfg, cfgRaw, theme) {
  const primary = cfg.theme_primary || (cfg.theme && cfg.theme.primary) || "#E4801C";
  const accent = cfg.theme_accent || (cfg.theme && cfg.theme.accent) || "#F5B301";
  const store = cfg.store_name || "Catálogo";
  // Fuentes del cliente (cada menú trae su combinación). Fallback: las genéricas del engine.
  const fonts = cfg.fonts
    ? `<link href="${esc(cfg.fonts)}" rel="stylesheet"/>`
    : `<link href="https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>`;
  return tpl
    .replace("<!--TITLE-->", esc(cfg.site_title || store))
    .replace("<!--FAVICON-->", esc(cfg.favicon || ""))
    .replace("<!--FONTS-->", fonts)
    .replace("<!--VARS-->", `:root{--primary:${esc(primary)};--accent:${esc(accent)}}`)
    .replace("<!--THEME-->", theme) // CSS bespoke del cliente: se inyecta tal cual (confiable)
    .replace("<!--LOGO-->", esc(cfg.logo || ""))
    .replace("<!--BRAND-->", esc(store))
    .replace("<!--BRANDSUB-->", cfg.brand_sub_html ? sanitizeBrandSub(cfg.brand_sub_html) : esc(cfg.brand_sub || ""))
    .replace("<!--DIVIDER-->", cfg.hero_divider ? '<div class="hero-divider"></div>' : "")
    .replace("<!--KICKER-->", cfg.hero_kicker ? `<p class="hero-kicker">${esc(cfg.hero_kicker)}</p>` : "")
    .replace("<!--HERO-->", cfg.hero_title || "") // hero_title admite HTML (lo pone el operador)
    .replace("<!--SEARCHPH-->", esc(cfg.search_placeholder || "Busca tu antojo..."))
    .replace("<!--COVERAGE-->", Array.isArray(cfg.location?.sedes) && cfg.location.sedes.some(s => s?.id && Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.radio_km > 0)
      ? '<script src="https://craft-catalog-engine.pages.dev/v1/geo.js" defer></script>' : '')
    .replace("<!--CONFIG-->", `window.__CONFIG__=${jsonInline(cfgRaw)}`);
}

export function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// esc: escapa para contexto HTML. El config lo edita el operador, pero escapamos por higiene.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Solo permite spans de color usados por la identidad de marca; cualquier otro HTML
// se trata como texto. Así brand_sub_html no se convierte en un bypass de XSS.
export function sanitizeBrandSub(raw) {
  const token = /<span style="color:(#fff|var\(--primary\))">([^<>]*)<\/span>/g;
  const parts = String(raw).split(token);
  if (parts.length === 1 && /[<>]/.test(String(raw))) return esc(raw);
  let html = "";
  for (let i = 0; i < parts.length; i += 3) {
    html += esc(parts[i]);
    if (i + 2 < parts.length) html += `<span style="color:${parts[i + 1]}">${esc(parts[i + 2])}</span>`;
  }
  return html;
}

const jsonType = "application/json;charset=utf-8";
const ok = (type, body) => ({ status: 200, headers: { "content-type": type, "cache-control": "public, max-age=60" }, body });
// HTML del menú: no-cache (revalida siempre) para que la página siempre referencie la versión
// vigente del motor (catalog.js?v=...). Sin esto, un HTML cacheado apunta a un catalog.js viejo
// y el cliente no recibe fixes del motor hasta que expire la caché.
const okHtml = (body) => ({ status: 200, headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-cache, must-revalidate" }, body });
const notFound = () => ({ status: 404, headers: {}, body: "No existe" });

// handle: enruta una petición ya parseada → {status, headers, body} (index.js lo envuelve en
// Response). Puro salvo por env.MENUS.get → testeable sin el runtime de CF ni el import de HTML.
export async function handle(url, env, template) {
  const slug = await resolveSlug(url.hostname, env);
  if (!slug) return notFound();

  // Datos JSON (comunes a menú y tienda): el app.js del cliente los baja en runtime.
  if (url.pathname === "/productos.json" || url.pathname === "/config.json") {
    const key = url.pathname === "/config.json" ? "config" : "productos";
    const data = await env.MENUS.get(`${slug}:${key}`);
    return ok(jsonType, data == null ? (key === "productos" ? "[]" : "{}") : data);
  }

  // Tienda bespoke: HTML/CSS/JS autorado (multi-página) servido estático desde {slug}:site.
  // Las imágenes NO pasan por aquí — van a R2 (media.craft-systems.com) por URL absoluta.
  const siteRaw = await env.MENUS.get(`${slug}:site`);
  if (siteRaw != null) {
    const file = siteFile(safeParse(siteRaw), url.pathname);
    return file ? ok(file.type, file.body) : notFound();
  }

  // Menú config-driven: render del template único con la config del cliente.
  const cfgRaw = await env.MENUS.get(`${slug}:config`);
  if (cfgRaw == null) return notFound();
  const theme = (await env.MENUS.get(`${slug}:theme`)) || "";
  return okHtml(render(template, safeParse(cfgRaw), cfgRaw, theme));
}

// siteFile: elige el archivo del mapa de la tienda para un pathname, con índice de directorio
// (como Pages): "/" y "/dir/" → …/index.html; "/dir" sin extensión → "/dir/index.html".
export function siteFile(site, pathname) {
  let path = pathname.endsWith("/") ? pathname + "index.html" : pathname;
  if (site[path] == null && !path.slice(1).includes(".")) path += "/index.html";
  const body = site[path];
  return body == null ? null : { body, type: contentType(path) };
}

export function contentType(path) {
  if (path.endsWith(".css")) return "text/css;charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript;charset=utf-8";
  if (path.endsWith(".json")) return jsonType;
  return "text/html;charset=utf-8";
}

// jsonInline: el JSON crudo va dentro de <script>. Neutraliza "</script>" y separadores de línea JS.
export function jsonInline(raw) {
  return raw.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
