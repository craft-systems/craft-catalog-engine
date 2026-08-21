/* craft-catalog-engine — cart.js
 * Carrito headless compartido: estado, persistencia, drawer, checkout WhatsApp (2 pasos opcional).
 * NO renderiza productos ni cards: eso es bespoke de cada tienda. Tras cada cambio emite
 * document dispatch 'cart:change' (detail:{items}) para que la tienda refresque sus botones.
 *
 * Uso en la tienda (tras cargar products/config):
 *   CraftCart.init({ products, config, storageKey:'ay_cart' });
 *   // botón agregar simple:  <button data-add="ID">   |  variante: la tienda llama CraftCart.add(id, variantes, qty)
 *   document.addEventListener('cart:change', refreshMyCards);
 *
 * DOM esperado (todos opcionales salvo el drawer): cartFab/navCartBtn (abrir), cartBadge/navCartBadge,
 * cartOverlay, cartDrawer, cartClose, cartItems, cartTotal, cartItemCount, btnCheckout.
 * Checkout 2 pasos (opt-in, solo si existe #cartStep2): cartStep2, cartBack, cartTitle,
 * fieldName, fieldPhone, fieldAddressWrap+fieldAddress, deliveryToggle(.dtog-btn[data-mode]), btnConfirm.
 */

// ── helpers puros (sin DOM, exportables para test) ─────────────────────────
function variantOptDisplay(o){ return o && typeof o === 'object' ? (o.label || o.name || '') : (o || ''); }

function cartKey(id, v){
  if(!v || !Object.keys(v).length) return String(id);
  return id + ':' + Object.entries(v).sort().map(([k,val]) => k + '=' + variantOptDisplay(val)).join(',');
}

function promoOf(p){
  const pr = Number(p && p.precio_promo) || 0, base = Number(p && p.precio) || 0;
  return (pr > 0 && pr < base) ? pr : null;
}

function resolveVariantPrice(p, variantes){
  if(p && variantes) for(const val of Object.values(variantes))
    if(val && typeof val === 'object' && val.price != null) return Number(val.price);
  return promoOf(p) ?? (Number(p && p.precio) || 0);
}

function formatPrice(n, currency){ return `${currency || '$'}${Number(n).toFixed(2)}`; }

const cartTotalQty   = items => items.reduce((s,i) => s + i.qty, 0);
const cartTotalPrice = items => items.reduce((s,i) => s + i.precio * i.qty, 0);

// Arma el texto del pedido para WhatsApp. fields: {name, phone, mode, address}.
function buildOrderMessage(items, config, fields){
  const cur = config.currency || '$';
  const line = i => {
    const vL = i.variantes ? Object.values(i.variantes).map(variantOptDisplay).filter(Boolean).join(' · ') : '';
    return `▸ ${i.nombre}${vL ? ' (' + vL + ')' : ''}\n  ${i.qty} × ${formatPrice(i.precio,cur)} = ${formatPrice(i.qty*i.precio,cur)}`;
  };
  const title = config.order_title || (config.store_name ? `PEDIDO ${config.store_name.toUpperCase()}` : 'PEDIDO');
  let msg = `${config.whatsapp_message || 'Hola! Quiero hacer un pedido:'}\n\n*${title}*\n━━━━━━━━━━━━━━━\n`;
  msg += items.map(line).join('\n') + '\n';
  msg += `━━━━━━━━━━━━━━━\n*TOTAL: ${formatPrice(cartTotalPrice(items),cur)}*\n`;
  if(fields && (fields.name || fields.phone || fields.address)){
    msg += '\n';
    if(fields.mode) msg += `*ENTREGA:* ${fields.mode === 'delivery' ? 'Domicilio' : 'Retiro en local'}\n`;
    if(fields.name)    msg += `*Cliente:* ${fields.name}\n`;
    if(fields.phone)   msg += `*Teléfono:* ${fields.phone}\n`;
    if(fields.address) msg += `*Dirección:* ${fields.address}\n`;
  }
  return msg;
}

// ── wiring de navegador ────────────────────────────────────────────────────
if(typeof document !== 'undefined'){ (function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { items: [], products: [], config: {}, storageKey: 'craft_cart' };
  let toastTimer;

  const cur = () => state.config.currency || '$';
  const fmt = n => formatPrice(n, cur());
  const find = key => state.items.find(i => i.key === key);
  const save = () => { try{ localStorage.setItem(state.storageKey, JSON.stringify(state.items)); }catch(e){} };

  function emit(){ document.dispatchEvent(new CustomEvent('cart:change', { detail: { items: state.items } })); }

  function toast(msg){
    const t = $('toast'); if(!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function add(id, variantes, qty){
    const p = state.products.find(x => String(x.id) === String(id));
    if(!p) return;
    qty = qty || 1;
    const key = cartKey(id, variantes), ex = find(key);
    if(ex){ ex.qty += qty; }
    else{
      const imgs = Array.isArray(p.imagenes) && p.imagenes.length ? p.imagenes : [p.imagen || ''];
      state.items.push({ key, id, nombre: p.nombre, precio: resolveVariantPrice(p, variantes), qty, variantes: variantes || {}, imagen: imgs[0] });
    }
    commit(); toast(`${p.nombre} agregado`);
  }
  function removeOne(key){
    const it = find(key); if(!it) return;
    if(--it.qty <= 0) state.items = state.items.filter(i => i.key !== key);
    commit();
  }
  function del(key){ state.items = state.items.filter(i => i.key !== key); commit(); }
  function commit(){ save(); renderDrawer(); emit(); }

  function renderDrawer(){
    const qty = cartTotalQty(state.items);
    const badge = v => { const el = $(v); if(el){ el.textContent = qty; el.classList.toggle('show', qty > 0); } };
    badge('cartBadge'); badge('navCartBadge');
    const total = $('cartTotal');     if(total) total.textContent = fmt(cartTotalPrice(state.items));
    const count = $('cartItemCount');  if(count) count.textContent = `${qty} producto${qty !== 1 ? 's' : ''}`;
    const co = $('btnCheckout');       if(co) co.disabled = qty === 0;
    const box = $('cartItems');        if(!box) return;
    if(!state.items.length){ box.innerHTML = '<div class="cart-empty"><p>Tu carrito está vacío</p></div>'; return; }
    box.innerHTML = state.items.map(it => {
      const vL = it.variantes ? Object.values(it.variantes).map(variantOptDisplay).filter(Boolean).join(' · ') : '';
      return `<div class="cart-item">
        <img src="${it.imagen || ''}" alt="${it.nombre}" onerror="this.style.opacity=0"/>
        <div class="cart-item-info">
          <div class="cart-item-name">${it.nombre}</div>
          ${vL ? `<div class="cart-item-detail">${vL}</div>` : ''}
          <div class="cart-item-detail">${it.qty} × ${fmt(it.precio)} = ${fmt(it.qty*it.precio)}</div>
        </div>
        <button class="cart-item-remove" data-key="${it.key}">✕</button>
      </div>`;
    }).join('');
  }

  // drawer open/close + 2 pasos
  const drawer = () => $('cartDrawer');
  function open(){ $('cartOverlay')?.classList.add('open'); drawer()?.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close(){ $('cartOverlay')?.classList.remove('open'); drawer()?.classList.remove('open'); document.body.style.overflow = ''; step1(); }
  function step1(){
    const s2 = $('cartStep2'); if(!s2) return;
    if($('cartItems')) $('cartItems').style.display = '';
    drawer()?.querySelector('.cart-footer')?.style.setProperty('display', '');
    s2.style.display = 'none';
    if($('cartTitle')) $('cartTitle').textContent = 'Mi carrito';
    if($('cartBack')) $('cartBack').style.display = 'none';
  }
  function step2(){
    if(!state.items.length) return;
    const s2 = $('cartStep2'); if(!s2){ checkout(); return; }  // sin form → checkout directo
    if($('cartItems')) $('cartItems').style.display = 'none';
    drawer()?.querySelector('.cart-footer')?.style.setProperty('display', 'none');
    s2.style.display = 'flex';
    if($('cartTitle')) $('cartTitle').textContent = 'Datos de entrega';
    if($('cartBack')) $('cartBack').style.display = '';
  }

  function checkout(){
    const num = (state.config.whatsapp_number || '').replace(/\D/g, '');
    if(!num){ alert('Número de WhatsApp no configurado'); return; }
    if(!state.items.length) return;
    let fields = null;
    if($('cartStep2')){
      const name = $('fieldName')?.value.trim() || '';
      const phone = $('fieldPhone')?.value.trim() || '';
      const mode = document.querySelector('.dtog-btn.active')?.dataset.mode || 'delivery';
      const address = mode === 'delivery' ? ($('fieldAddress')?.value.trim() || '') : '';
      if(!name || !phone){ toast('Completa tu nombre y teléfono'); return; }
      if(mode === 'delivery' && !address){ toast('Ingresa tu dirección de entrega'); return; }
      fields = { name, phone, mode, address };
    }
    const msg = buildOrderMessage(state.items, state.config, fields) + `\n${location.href}`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
    if(window.dataLayer) window.dataLayer.push({ event: 'whatsapp_checkout', ecommerce: {
      value: cartTotalPrice(state.items), currency: 'USD',
      items: state.items.map(i => ({ item_id: i.id, item_name: i.nombre, quantity: i.qty, price: i.precio }))
    }});
  }

  // delegación de eventos genéricos (markup bespoke, handlers genéricos)
  document.addEventListener('click', e => {
    const rm = e.target.closest('.cart-item-remove'); if(rm){ e.stopPropagation(); del(rm.dataset.key); return; }
    const a = e.target.closest('[data-add]'); if(a){ e.preventDefault(); add(a.dataset.add, {}, 1); return; }
    const q = e.target.closest('[data-action]');
    if(q){ e.stopPropagation(); const { action, id, key } = q.dataset;
      if(action === 'inc') add(id, {}, 1); if(action === 'dec' && key) removeOne(key); return; }
  });

  function bind(){
    $('cartFab')?.addEventListener('click', open);
    $('navCartBtn')?.addEventListener('click', open);
    $('cartOverlay')?.addEventListener('click', close);
    $('cartClose')?.addEventListener('click', close);
    $('btnCheckout')?.addEventListener('click', step2);   // sin #cartStep2, step2() cae a checkout directo
    $('cartBack')?.addEventListener('click', step1);
    $('btnConfirm')?.addEventListener('click', checkout);
    $('deliveryToggle')?.addEventListener('click', e => {
      const btn = e.target.closest('.dtog-btn'); if(!btn) return;
      document.querySelectorAll('.dtog-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const wrap = $('fieldAddressWrap');
      if(wrap) wrap.style.display = btn.dataset.mode === 'delivery' ? '' : 'none';
    });
    document.addEventListener('keydown', e => { if(e.key === 'Escape') close(); });
  }

  function init({ products, config, storageKey } = {}){
    state.products = products || [];
    state.config = config || {};
    if(storageKey) state.storageKey = storageKey;
    try{ const s = JSON.parse(localStorage.getItem(state.storageKey) || '[]'); if(Array.isArray(s)) state.items = s; }catch(e){}
    // descarta ítems de productos que ya no existen
    state.items = state.items.filter(ci => state.products.find(p => String(p.id) === String(ci.id)));
    bind(); renderDrawer(); emit();
  }

  window.CraftCart = { init, add, removeOne, del, open, close, formatPrice: fmt, get items(){ return state.items; } };
})(); }

// export para tests en node (inerte en navegador)
if(typeof module !== 'undefined' && module.exports)
  module.exports = { cartKey, variantOptDisplay, resolveVariantPrice, cartTotalPrice, cartTotalQty, buildOrderMessage, formatPrice, promoOf };
