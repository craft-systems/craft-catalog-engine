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
    .replace("<!--BRANDSUB-->", esc(cfg.brand_sub || ""))
    .replace("<!--DIVIDER-->", cfg.hero_divider ? '<div class="hero-divider"></div>' : "")
    .replace("<!--KICKER-->", cfg.hero_kicker ? `<p class="hero-kicker">${esc(cfg.hero_kicker)}</p>` : "")
    .replace("<!--HERO-->", cfg.hero_title || "") // hero_title admite HTML (lo pone el operador)
    .replace("<!--SEARCHPH-->", esc(cfg.search_placeholder || "Busca tu antojo..."))
    .replace("<!--CONFIG-->", `window.__CONFIG__=${jsonInline(cfgRaw)}`);
}

export function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// esc: escapa para contexto HTML. El config lo edita el operador, pero escapamos por higiene.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// jsonInline: el JSON crudo va dentro de <script>. Neutraliza "</script>" y separadores de línea JS.
export function jsonInline(raw) {
  return raw.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
