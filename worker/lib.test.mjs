import { test } from "node:test";
import assert from "node:assert";
import { resolveSlug, render, esc, jsonInline, sanitizeBrandSub } from "./src/lib.js";

const env = { MENUS: { get: async (k) => (k === "domain:pedidos.pizza.com" ? "pizzaplanet" : null) } };

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
