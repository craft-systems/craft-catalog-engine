import TEMPLATE from "../template.html";
import { resolveSlug, render, safeParse } from "./lib.js";

// Menús en el edge: un Worker sirve todos los catálogos desde KV, ruteando por hostname.
//   {sub}.craft-systems.com → slug = sub · dominio propio (CNAME) → KV domain:{host}
// Datos en KV: {slug}:config (JSON), {slug}:productos (JSON), {slug}:theme (CSS).
// Imágenes → R2 en media.craft-systems.com (ruta propia, no pasa por aquí).

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const slug = await resolveSlug(url.hostname, env);
    if (!slug) return new Response("No existe", { status: 404 });

    if (url.pathname === "/productos.json") {
      const productos = await env.MENUS.get(`${slug}:productos`);
      return new Response(productos == null ? "[]" : productos, { headers: json() });
    }

    const cfgRaw = await env.MENUS.get(`${slug}:config`);
    if (cfgRaw == null) return new Response("No existe", { status: 404 });
    const theme = (await env.MENUS.get(`${slug}:theme`)) || "";

    const html = render(TEMPLATE, safeParse(cfgRaw), cfgRaw, theme);
    return new Response(html, {
      headers: { "content-type": "text/html;charset=utf-8", "cache-control": "public, max-age=60" },
    });
  },
};

function json() {
  return { "content-type": "application/json;charset=utf-8", "cache-control": "public, max-age=60" };
}
