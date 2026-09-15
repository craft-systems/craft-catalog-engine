import { test } from "node:test";
import assert from "node:assert";
import { resolveSlug, render, esc, jsonInline, sanitizeBrandSub, handle, siteFile, contentType } from "./src/lib.js";

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

test("siteFile / contentType", () => {
  assert.equal(siteFile(store, "/").body, "<h1>home</h1>");
  assert.equal(siteFile(store, "/nope"), null);
  assert.equal(contentType("/a.css"), "text/css;charset=utf-8");
  assert.equal(contentType("/a.js"), "application/javascript;charset=utf-8");
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
