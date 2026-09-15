import TEMPLATE from "../template.html";
import { handle } from "./lib.js";

// Un Worker sirve TODOS los catálogos desde KV, ruteando por hostname:
//   {sub}.craft-systems.com → slug=sub · dominio propio (CNAME) → KV domain:{host}
// Dos modos por slug (ver handle en lib.js):
//   · menú config-driven → KV {slug}:config|:productos|:theme, render del template único
//   · tienda bespoke      → KV {slug}:site (mapa path→HTML/CSS/JS autorado), servido estático
// Imágenes → R2 en media.craft-systems.com (URL absoluta, NO pasan por el Worker).

export default {
  async fetch(request, env) {
    const { status, headers, body } = await handle(new URL(request.url), env, TEMPLATE);
    return new Response(body, { status, headers });
  },
};
