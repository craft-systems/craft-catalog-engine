import { test } from "node:test";
import assert from "node:assert";
import { resolveSlug, render, trackingTags, SHELL_EN, esc, jsonInline, sanitizeBrandSub, handle, siteFile, contentType } from "./src/lib.js";

const env = { MENUS: { get: async (k) => (k === "domain:pedidos.pizza.com" ? "pizzaplanet" : null) } };

// KV con una tienda (demo, tiene :site) y un menú (pizza, solo :config) para probar el ruteo.
const store = { "/index.html": "<h1>home</h1>", "/pages/productos.html": "<h1>cat</h1>", "/assets/app.js": "x" };
const kv = {
  "demo:site": JSON.stringify(store),
  "demo:productos": '[{"id":"x"}]',
  "pizza:config": '{"store_name":"Pizza"}',
};
const env2 = { MENUS: { get: async (k) => (k in kv ? kv[k] : null) } };
const U = (host, path = "/") => new URL(`https://${host}${path}`);

test('cobertura carga el selector solo para menús con sedes geolocalizadas',()=>{
  const tpl='<!--COVERAGE--><script><!--CONFIG--></script>';
  assert.ok(!render(tpl,{},'{}','').includes('/geo.js'));
  const cfg={location:{sedes:[{id:'norte',nombre:'Norte',lat:0,lng:0,radio_km:2}]}};
  const result=render(tpl,cfg,JSON.stringify(cfg),'');
  assert.ok(result.includes('/v1/geo.js'));assert.ok(result.includes('"id":"norte"'));
});

test("handle: tienda sirve estático desde {slug}:site (/ → /index.html, query ignorada, 404)", async () => {
  const home = await handle(U("demo.craft-systems.com", "/"), env2, "TPL");
  assert.equal(home.status, 200);
  assert.equal(home.body, "<h1>home</h1>");
  assert.match(home.headers["content-type"], /text\/html/);

  const js = await handle(U("demo.craft-systems.com", "/assets/app.js?v=2"), env2, "TPL");
  assert.match(js.headers["content-type"], /javascript/); // content-type por extensión, query ignorada

  const prod = await handle(U("demo.craft-systems.com", "/productos.json"), env2, "TPL");
  assert.equal(prod.body, '[{"id":"x"}]');

  assert.equal((await handle(U("demo.craft-systems.com", "/nope"), env2, "TPL")).status, 404);
});

test("handle: sin {slug}:site rutea al render del menú", async () => {
  const out = await handle(U("pizza.craft-systems.com", "/"), env2, "<title><!--TITLE--></title>");
  assert.equal(out.status, 200);
  assert.ok(out.body.includes("Pizza"));       // render inyectó store_name
  assert.ok(!out.body.includes("<!--TITLE-->"));
});

test("siteFile / contentType (con índice de directorio)", () => {
  assert.equal(siteFile(store, "/").body, "<h1>home</h1>");
  assert.equal(siteFile(store, "/nope"), null);
  assert.equal(contentType("/a.css"), "text/css;charset=utf-8");
  assert.equal(contentType("/a.js"), "application/javascript;charset=utf-8");
  const nested = { "/funnel/x/index.html": "F" };
  assert.equal(siteFile(nested, "/funnel/x/").body, "F");   // barra final → index.html
  assert.equal(siteFile(nested, "/funnel/x").body, "F");    // sin extensión → /index.html
});

test("resolveSlug", async () => {
  assert.equal(await resolveSlug("zuba.craft-systems.com", env), "zuba");
  assert.equal(await resolveSlug("craft-systems.com", env), null); // apex
  assert.equal(await resolveSlug("www.craft-systems.com", env), null);
  assert.equal(await resolveSlug("api.craft-systems.com", env), null); // reservado
  assert.equal(await resolveSlug("a.b.craft-systems.com", env), null); // 2 niveles
  assert.equal(await resolveSlug("pedidos.pizza.com", env), "pizzaplanet"); // dominio propio
  assert.equal(await resolveSlug("otro.com", env), null);
});

test("render inyecta tokens/config y escapa XSS", () => {
  const tpl = "<title><!--TITLE--></title><style><!--VARS--></style><style><!--THEME--></style><img src='<!--LOGO-->'><script><!--CONFIG--></script>";
  const cfg = { store_name: 'A"><script>x</script>', theme_primary: "#111", logo: "https://media.craft-systems.com/l.png" };
  const raw = JSON.stringify(cfg);
  const out = render(tpl, cfg, raw, "body{color:red}");
  assert.ok(out.includes("--primary:#111"));
  assert.ok(out.includes("body{color:red}")); // theme inline
  assert.ok(out.includes("window.__CONFIG__="));
  assert.ok(!out.includes("<title>A\"><script>x")); // el título escapado, no rompe el head
});

test("trackingTags emite etiquetas estándar y descarta IDs inválidos", () => {
  const tags = trackingTags({ tracking: { meta_pixel_id: "1216337266007176", tiktok_pixel_id: "D0HCDTBC77U0QQJ0ADPG", gtm_container_id: "GTM-WJDC95F" } });
  assert.match(tags.head, /connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(tags.head, /analytics\.tiktok\.com\/i18n\/pixel\/events\.js/);
  assert.match(tags.head, /googletagmanager\.com\/gtm\.js/);
  assert.match(tags.noscript, /googletagmanager\.com\/ns\.html\?id=GTM-WJDC95F/);
  assert.equal(trackingTags({ tracking: { meta_pixel_id: '<script>', gtm_container_id: 'GTM-<bad>' } }).head, "");
});

test("jsonInline neutraliza cierre de script", () => {
  assert.ok(!jsonInline('{"x":"</script>"}').includes("</script>"));
});

test("esc", () => {
  assert.equal(esc('<b>"&'), "&lt;b&gt;&quot;&amp;");
});

test("sanitizeBrandSub permite solo spans de color de marca", () => {
  assert.equal(
    sanitizeBrandSub('<span style="color:#fff">Más</span> <span style="color:var(--primary)">Sabor.</span>'),
    '<span style="color:#fff">Más</span> <span style="color:var(--primary)">Sabor.</span>',
  );
  assert.equal(sanitizeBrandSub('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test("SHELL_EN: cada texto existe en template.html y locale en traduce el shell; sin locale no cambia", async () => {
  const { readFileSync } = await import("node:fs");
  const tpl = readFileSync(new URL("./template.html", import.meta.url), "utf8");
  for (const [es] of SHELL_EN) assert.ok(tpl.includes(es), `falta en template: ${es}`);
  const cfg = { store_name: "S" };
  assert.equal(render(tpl, cfg, "{}", ""), render(tpl, { ...cfg, locale: "es" }, "{}", ""));
  const en = render(tpl, { ...cfg, locale: "en" }, "{}", "");
  assert.match(en, /<html lang="en">/);
  for (const w of ["Tu Pedido", "Realizar pedido", "Retiro en local", "Ver mi carrito", "Confirmar pedido"]) assert.ok(!en.includes(w), w);
});
