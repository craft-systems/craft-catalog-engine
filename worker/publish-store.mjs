#!/usr/bin/env node
// Publica una tienda bespoke (carpeta estática legacy Pages/GitHub) al edge:
// construye el mapa {slug}:site (HTML/CSS/JS) + {slug}:productos/:config, reescribiendo rutas de
// imagen a R2. Las imágenes (media/, producto/) van a R2, NO al KV. No toca prod: escribe payloads
// en /tmp e imprime los comandos (local para probar, remoto para publicar con aprobación).
//   node publish-store.mjs --dir ../../pages/plantillas/demo-ropa-elegante --slug demo-ropa
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { execFileSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((v, i, a) => (v.startsWith("--") ? [[v.slice(2), a[i + 1]]] : [])),
);
const { dir, slug } = args;
if (!dir || !slug) { console.error("uso: --dir <carpeta> --slug <slug>"); process.exit(1); }

const R2 = `https://media.craft-systems.com/sites/${slug}`;
// ponytail: reescribe solo los patrones observados en las plantillas actuales:
//   ./media|../media → R2/media ; "/producto/ (productos.json) → R2/producto ;
//   fetch relativos de productos.json/config.json → ruta absoluta (rompen entre / y /pages/).
// Un asset nuevo (p.ej. url(../media/..) en CSS) necesitaría una regla más aquí.
const rewrite = (t) => t
  .replace(/(?:\.\.?\/)+media\//g, `${R2}/media/`)
  .replace(/(["'])\/producto\//g, `$1${R2}/producto/`)
  .replace(/(?:\.\.?\/)+(productos|config)\.json/g, "/$1.json");

const SKIP = /(^|\/)(media|producto|\.git|\.github|node_modules)$/;
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (statSync(p).isDirectory()) return SKIP.test(p) ? [] : walk(p);
  return [p];
});

const TEXT = new Set([".html", ".css", ".js"]);
const site = {};
for (const p of walk(dir)) {
  if (TEXT.has(extname(p))) site["/" + relative(dir, p)] = rewrite(readFileSync(p, "utf8"));
}
const rd = (f) => { try { return rewrite(readFileSync(join(dir, f), "utf8")); } catch { return null; } };
const write = (name, data) => (writeFileSync(`/tmp/${slug}.${name}`, data), `/tmp/${slug}.${name}`);
const fSite = write("site.json", JSON.stringify(site));
const fProd = write("productos.json", rd("productos.json") ?? "[]");
const fCfg = write("config.json", rd("config.json") ?? "{}");

console.log(`\n{slug}:site → ${Object.keys(site).length} archivos: ${Object.keys(site).join(", ")}`);
const kv = (mode) => [
  `wrangler kv key put ${mode} --binding=MENUS "${slug}:site"      --path=${fSite}`,
  `wrangler kv key put ${mode} --binding=MENUS "${slug}:productos" --path=${fProd}`,
  `wrangler kv key put ${mode} --binding=MENUS "${slug}:config"    --path=${fCfg}`,
].join("\n");

console.log(`\n# --- Prueba LOCAL (wrangler dev lee .wrangler/state) ---`);
console.log(`wrangler kv key put --local --binding=MENUS "domain:localhost" "${slug}"`);
console.log(kv("--local"));
console.log(`wrangler dev &   # luego: curl -s localhost:8787/ ; curl -s localhost:8787/productos.json`);

// Comprimir imágenes EN LOCAL antes de R2 (recompresión+resize+strip; preserva nombres/formatos
// → las URLs a R2 no cambian). Solo en onboard desde local; las ediciones por UI van directo a R2.
console.log(`\n# imágenes optimizadas en local (→ /tmp/${slug}.img):`);
const imgOut = `/tmp/${slug}.img`;
const OPT = join(import.meta.dirname, "optimize-images.sh");
const imgDirs = [];
for (const sub of ["media", "producto"]) {
  try {
    if (!statSync(join(dir, sub)).isDirectory()) continue;
    process.stdout.write("  " + execFileSync("bash", [OPT, join(dir, sub), `${imgOut}/${sub}`], { encoding: "utf8" }));
    imgDirs.push(sub);
  } catch { /* sin esa carpeta: nada que optimizar */ }
}

console.log(`\n# --- Publicar a PROD (requiere aprobación del operador) ---`);
for (const sub of imgDirs)
  console.log(`rclone copy --checksum "${imgOut}/${sub}" r2:craft-crm/sites/${slug}/${sub}`);
console.log(kv("--remote"));
console.log(`# route: POST CF API /workers/routes  pattern=${slug}.craft-systems.com/*  (igual que CreateMenuRoute)`);
