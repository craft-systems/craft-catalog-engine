  (function(){
    'use strict';

    /* ── STATE ── */
    let cartItems = [];
    let favs = [];
    let products = [];
    let config = {};
    let activeFilter = 'all';   // 'all' | <slug> | '__offers__' | '__favs__'
    let searchQuery = '';
    let categorySlugs = [];
    let storeClosed = false;    // fuera de horario (config.hours) → bloquea el checkout, no la navegación

    let modalProduct = null, modalQty = 1, modalVariants = {}, modalDist = {}, modalRepeat = {}, modalCombo = {}, sliderIdx = 0, sliderImages = [];

    /* ── DOM REFS ── */
    const $catalog=document.getElementById('catalog'),$searchInput=document.getElementById('searchInput'),
      $catStrip=document.getElementById('catStrip'),$cartOverlay=document.getElementById('cartOverlay'),
      $cartDrawer=document.getElementById('cartDrawer'),$cartClose=document.getElementById('cartClose'),
      $cartItems=document.getElementById('cartItems'),$cartTotal=document.getElementById('cartTotal'),
      $cartItemCount=document.getElementById('cartItemCount'),$btnCheckout=document.getElementById('btnCheckout'),
      $toast=document.getElementById('toast'),$modalOverlay=document.getElementById('modalOverlay'),
      $modalClose=document.getElementById('modalClose'),$modalFav=document.getElementById('modalFav'),
      $sliderTrack=document.getElementById('sliderTrack'),$sliderPrev=document.getElementById('sliderPrev'),
      $sliderNext=document.getElementById('sliderNext'),$sliderDots=document.getElementById('sliderDots'),
      $modalDetail=document.getElementById('modalDetail'),$navBadge=document.getElementById('navBadge'),
      $cartPeek=document.getElementById('cartPeek'),$peekCount=document.getElementById('peekCount'),
      $peekTotal=document.getElementById('peekTotal');

    /* ── HELPERS ── */
    const normalize=s=>(s||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

    function parsePrice(p){
      if(typeof p.precio==='number') return p.precio;
      const m=(p.precio||'').toString().match(/[\d.]+/);
      return m?parseFloat(m[0]):0;
    }
    const getImages=p=>Array.isArray(p.imagenes)&&p.imagenes.length?p.imagenes:(p.imagen?[p.imagen]:[]);
    const getOptionKey=o=>(typeof o==='object'&&o!==null)?(o.label||''):String(o);
    const getOptionDisplay=getOptionKey;
    const getOptionPrice=o=>(typeof o==='object'&&o!==null&&typeof o.price==='number')?o.price:null;
    // Recargo aditivo embebido en el nombre: "... +$1", "... +$0.25". Suma sobre la base.
    const getOptionDelta=o=>{const m=String(getOptionDisplay(o)).match(/\+\s*\$\s*([0-9]+(?:[.,][0-9]+)?)/);return m?parseFloat(m[1].replace(',','.')):0;};
    // ponytail: alitas/wings con >=8 uds y >1 salsa → repartir cantidad por salsa. Total sale del nombre ("x 8", "x20").
    const unitCount=p=>{const m=(p.nombre||'').match(/x\s*(\d+)/i);return m?+m[1]:0;};
    function distGroup(p){
      // Grupo explícito de distribución (elige N repartibles): total = número en el nombre del grupo.
      const dg=(p.variantes||[]).find(g=>g.type==='distribute'&&Array.isArray(g.options)&&g.options.length>1);
      if(dg){const m=String(dg.name||'').match(/\d+/);return{group:dg,total:m?+m[0]:1};}
      // Alitas: total = cantidad en el nombre del producto ("x N"), categoría alitas/wings.
      if(unitCount(p)<8) return null;
      if(!(p.categorias||[]).some(c=>/alit|wing/i.test(c))) return null;
      const g=(p.variantes||[]).find(g=>Array.isArray(g.options)&&g.options.length>1);
      return g?{group:g,total:unitCount(p)}:null;
    }

    // Promo NxM (ej. 3x2): grupo con "pick" selectores; se cobra todo menos las "free" opciones
    // más baratas elegidas. null si el producto no usa el mecanismo (retrocompatible).
    function comboInfo(p){
      if(!Array.isArray(p.variantes)) return null;
      const gi=p.variantes.findIndex(g=>g&&g.pick>0);
      if(gi<0) return null;
      const g=p.variantes[gi];
      const priceOf=lbl=>{const o=(g.options||[]).find(o=>getOptionKey(o)===lbl);return o?(getOptionPrice(o)||0):0;};
      return {gi,g,pick:g.pick,free:g.free||0,item:g.item||'Opción',priceOf};
    }
    // Precio 3x2: suma de las elegidas menos las `free` más baratas.
    const comboTotal=(ci,labels)=>{
      const prices=labels.filter(Boolean).map(ci.priceOf).sort((a,b)=>a-b);
      return prices.slice(ci.free).reduce((s,x)=>s+x,0);
    };
    function getEffectivePrice(p,variantes){
      if(!variantes||!Object.keys(variantes).length) return parsePrice(p);
      const ci=comboInfo(p);
      // pick con opciones sin precio (ej. salsas incluidas) = precio base; con precio = NxM (suma−free).
      if(ci){
        const priced=(ci.g.options||[]).some(o=>getOptionPrice(o)!==null);
        return priced?comboTotal(ci,Array.from({length:ci.pick},(_,k)=>variantes['c'+k])):parsePrice(p);
      }
      let absolute=null,delta=0;
      if(Array.isArray(p.variantes)){
        for(let i=0;i<p.variantes.length;i++){
          const sel=variantes[i];
          if(sel===undefined) continue;
          const opt=p.variantes[i].options.find(o=>getOptionKey(o)===sel);
          if(!opt) continue;
          const vp=getOptionPrice(opt);
          if(vp!==null) absolute=vp;      // selector absoluto (ej. Bebidas 1L)
          else delta+=getOptionDelta(opt); // recargo aditivo del combo
        }
      }
      return (absolute!==null?absolute:parsePrice(p))+delta;
    }
    function formatPrice(n){
      const c=config.currency||'$';
      const d=Math.abs(n)<10?2:(Number.isInteger(n)?0:2);
      return c+n.toFixed(d);
    }
    const cartKey=(id,v)=>(!v||!Object.keys(v).length)?String(id):id+':'+Object.entries(v).sort().map(([k,x])=>k+'='+x).join(',');
    const variantLabel=v=>(!v||!Object.keys(v).length)?'':Object.entries(v).map(([,x])=>x).join(' · ');

    function getStockInfo(p){
      if(p.stock===0) return {badge:'Agotado',cls:'sold-out',canAdd:false,maxQty:0};
      if(typeof p.stock==='number'&&p.stock>=1&&p.stock<=3) return {badge:'¡Quedan pocas!',cls:'low-stock',canAdd:true,maxQty:p.stock};
      return {badge:null,cls:'',canAdd:true,maxQty:Infinity};
    }
    const badgeCat=()=>config.badge_category||null;
    const isOffer=p=>!!p.precio_promo||(badgeCat()&&(p.categorias||[]).includes(badgeCat()));
    const isPromo=p=>p.tipo==='promocion';
    // Oferta activa hoy: sku lleva el/los día(s) de la semana (0=dom..6=sáb, coma-sep). Vacío = siempre.
    // ponytail: reusar sku como día de la promo; migrar a columna promo_days si se necesita SKU real en promos.
    const promoActiveToday=p=>{
      const raw=(p.sku||'').trim();
      if(!raw) return true;
      const today=new Date().getDay();
      return raw.split(',').map(s=>parseInt(s,10)).includes(today);
    };

    // Category → emoji icon (keyword match on slug + visible name)
    const CAT_ICONS=[['hamburg','🍔'],['burger','🍔'],['pizza','🍕'],['pollo','🍗'],['alit','🍗'],['wing','🍗'],
      ['papa','🍟'],['frit','🍟'],['acompa','🍟'],['bebida','🥤'],['refres','🥤'],['gaseosa','🥤'],['jugo','🧃'],
      ['cafe','☕'],['café','☕'],['combo','🍱'],['postre','🍰'],['dulce','🍰'],['helado','🍦'],['ensalada','🥗'],
      ['sushi','🍣'],['taco','🌮'],['burrito','🌯'],['wrap','🌯'],['sandwi','🥪'],['hot dog','🌭'],['hotdog','🌭'],
      ['perro','🌭'],['salchi','🌭'],['nacho','🧀'],['queso','🧀'],['carne','🥩'],['parrilla','🥩'],['asado','🥩'],
      ['pasta','🍝'],['sopa','🍲'],['caldo','🍲'],['marisc','🦐'],['camaron','🦐'],['ceviche','🦐'],['pescado','🐟'],
      ['desayuno','🍳'],['huevo','🍳'],['pan','🥖'],['empana','🥟'],['dona','🍩'],['galleta','🍪'],['pastel','🎂'],
      ['torta','🎂'],['fruta','🍓'],['vega','🥗'],['bowl','🥣'],['arroz','🍚']];
    // Emoji líder de un texto (el que el operador pone en el nombre de la categoría), '' si no hay.
    const leadingEmoji=str=>{
      const m=(str||'').match(/^\s*(\p{Extended_Pictographic}(?:[️‍\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic})*)/u);
      return m?m[1].trim():'';
    };
    // Nombre de categoría sin el emoji líder (para el label del chip / header).
    const catLabel=name=>{const e=leadingEmoji(name);return e?(name||'').replace(e,'').trim():(name||'');};
    function catIcon(slug,name){
      const e=leadingEmoji(name);          // el emoji del nombre manda (control del operador desde el CRM)
      if(e) return e;
      const s=normalize(slug+' '+(name||''));
      for(const [k,ic] of CAT_ICONS) if(s.includes(normalize(k))) return ic;
      return '🍽️';
    }

    let toastTimer;
    function showToast(msg){
      $toast.textContent=msg;$toast.classList.add('show');
      clearTimeout(toastTimer);toastTimer=setTimeout(()=>$toast.classList.remove('show'),2200);
    }

    /* ── FAVORITES ── */
    const isFav=id=>favs.includes(String(id));
    function toggleFav(id){
      id=String(id);
      const i=favs.indexOf(id);
      if(i>=0){favs.splice(i,1);showToast('Quitado de favoritos');}
      else{favs.push(id);showToast('❤ Agregado a favoritos');}
      saveFavs();
      document.querySelectorAll(`.fav-btn[data-fav="${id}"]`).forEach(b=>b.classList.toggle('active',isFav(id)));
      if($modalFav.dataset.fav===id){$modalFav.classList.toggle('active',isFav(id));$modalFav.textContent=isFav(id)?'♥':'♡';}
      if(activeFilter==='__favs__') renderCatalog();
    }
    const saveFavs=()=>{try{localStorage.setItem('menu_favs',JSON.stringify(favs));}catch(e){}};
    function loadFavs(){try{const s=JSON.parse(localStorage.getItem('menu_favs')||'[]');if(Array.isArray(s))favs=s.map(String);}catch(e){}}

    /* ── CART LOGIC ── */
    const cartFind=key=>cartItems.find(i=>i.key===key);
    function cartAdd(id,variantes,qty){
      const p=products.find(x=>String(x.id)===String(id));
      if(!p) return;
      const stock=getStockInfo(p),key=cartKey(id,variantes),existing=cartFind(key);
      const newQty=(existing?existing.qty:0)+qty;
      if(newQty>stock.maxQty){showToast('Stock insuficiente');return;}
      if(existing) existing.qty+=qty;
      else cartItems.push({key,id,nombre:p.nombre,precio:getEffectivePrice(p,variantes),qty,variantes:variantes||{},imagen:getImages(p)[0]||''});
      saveCart();updateCartUI();updateCardButtons();showToast('Agregado al pedido');
    }
    function cartRemoveOne(key){
      const item=cartFind(key);if(!item) return;
      item.qty--;if(item.qty<=0) cartItems=cartItems.filter(i=>i.key!==key);
      saveCart();updateCartUI();updateCardButtons();
    }
    function cartDelete(key){cartItems=cartItems.filter(i=>i.key!==key);saveCart();updateCartUI();updateCardButtons();}
    const saveCart=()=>{try{localStorage.setItem('menu_cart',JSON.stringify(cartItems));}catch(e){}};
    function loadCart(){try{const s=JSON.parse(localStorage.getItem('menu_cart')||'[]');if(Array.isArray(s))cartItems=s;}catch(e){}}
    const cartTotalQty=()=>cartItems.reduce((s,i)=>s+i.qty,0);
    const cartTotalPrice=()=>cartItems.reduce((s,i)=>s+i.precio*i.qty,0);

    /* ── HORARIO Y EMPAQUE (opt-in por config; no-op si faltan) ── */
    // Modo de entrega activo en el checkout (por defecto domicilio; el empaque solo aplica a domicilio).
    const currentMode=()=>document.querySelector('.dtog-btn.active')?.dataset.mode||'delivery';
    // Costo de empaque: plano por pedido (per_order, default) o por unidad (per_unit). 0 en retiro o sin config.
    // exempt_categories: ítems cuya categoría esté ahí no pagan empaque (ej. bebidas). Sin la clave = todos pagan.
    function packagingFee(mode){
      const p=config.packaging;
      if(!p||!p.enabled||mode==='pickup') return 0;
      const cost=+p.cost||0; if(cost<=0) return 0;
      const exempt=new Set(p.exempt_categories||[]);
      const billable=exempt.size?cartItems.filter(i=>{
        const prod=products.find(x=>String(x.id)===String(i.id));
        return !prod||(prod.categorias||[]).every(c=>!exempt.has(c));
      }):cartItems;
      if(!billable.length) return 0;
      return p.mode==='per_unit' ? cost*billable.reduce((s,i)=>s+i.qty,0) : cost;
    }
    // Abierto/cerrado según config.hours.weekly (claves 0=Dom..6=Sáb, convención getDay) en su zona horaria.
    // Sin config → siempre abierto. ponytail: la cola nocturna (18:00–02:00) cuenta el tramo de esa
    // misma noche; el tramo 00:00–02:00 se atribuye al día siguiente — si un local lo necesita, se
    // configura ese rango en el día correspondiente. Suficiente para cierres a las 00:00.
    function storeHoursOpen(h){
      if(!h||!h.weekly) return true;
      let parts;
      try{ parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:h.tz||'America/Guayaquil',
        hour12:false,weekday:'short',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value])); }
      catch(e){ return true; }
      const day={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[parts.weekday];
      let hh=+parts.hour; if(hh===24) hh=0;
      const mins=hh*60+(+parts.minute), toMin=s=>{const [a,b]=String(s).split(':');return (+a)*60+(+b||0);};
      const ranges=h.weekly[day]||[];
      return ranges.some(r=>{const s=toMin(r[0]),e=toMin(r[1]);return e>s?(mins>=s&&mins<e):(mins>=s||mins<e);});
    }

    /* ── CATEGORY STRIP ── */
    // Orden: config.category_order primero (el sync lo preserva), luego el resto. El sync
    // regenera config.categories alfabéticamente, así que sin esto Extras saldría antes.
    function orderedCategorySlugs(){
      const catMap=config.categories||{};
      const pref=Array.isArray(config.category_order)?config.category_order:[];
      const rest=Object.keys(catMap).filter(s=>!pref.includes(s));
      return [...pref.filter(s=>s in catMap),...rest];
    }
    function buildCatStrip(){
      const catMap=config.categories||{};
      categorySlugs=orderedCategorySlugs();
      let html=`<button class="cat-chip active" data-cat="all"><span class="ic">🔥</span><span class="lb">Todo</span></button>`;
      categorySlugs.forEach(slug=>{
        const name=catMap[slug]||slug;
        html+=`<button class="cat-chip" data-cat="${slug}"><span class="ic">${catIcon(slug,name)}</span><span class="lb">${catLabel(name)}</span></button>`;
      });
      $catStrip.innerHTML=html;
    }
    function setActiveChip(cat){
      $catStrip.querySelectorAll('.cat-chip').forEach(c=>c.classList.toggle('active',c.dataset.cat===cat));
    }

    /* ── CARD TEMPLATE ── */
    function cardHTML(p,i){
      const imgs=getImages(p);
      const inCartQty=cartItems.filter(ci=>String(ci.id)===String(p.id)).reduce((s,ci)=>s+ci.qty,0);
      const hasVariants=Array.isArray(p.variantes)&&p.variantes.length>0;
      const stock=getStockInfo(p);
      const catLabels=config.categories||{};
      const imgHTML=imgs[0]?`<img src="${imgs[0]}" alt="${p.nombre}" loading="lazy"/>`:`<div class="card-img-placeholder">${catIcon((p.categorias||[])[0],p.nombre)}</div>`;
      const badgeHTML=(badgeCat()&&(p.categorias||[]).includes(badgeCat()))?`<span class="card-badge">${catLabels[badgeCat()]||badgeCat()}</span>`:(p.precio_promo?`<span class="card-badge">Oferta</span>`:'');
      const stockBadgeHTML=stock.badge?`<span class="card-stock-badge ${stock.cls}">${stock.badge}</span>`:'';
      const imgCountHTML=imgs.length>1?`<span class="card-img-count"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>${imgs.length}</span>`:'';
      const priceDisplay=typeof p.precio==='number'?formatPrice(p.precio):(p.precio||'');
      return `
        <div class="card" data-id="${p.id}" style="animation-delay:${i*.04}s">
          <div class="card-img" data-open="${p.id}">
            ${imgHTML}${badgeHTML}${stockBadgeHTML}${imgCountHTML}
            <button class="fav-btn${isFav(p.id)?' active':''}" data-fav="${p.id}" aria-label="Favorito">${isFav(p.id)?'♥':'♡'}</button>
          </div>
          <div class="card-body">
            <div class="card-name">${p.nombre}</div>
            ${p.descripcion?`<div class="card-desc">${p.descripcion}</div>`:''}
            <div class="card-foot">
              <div class="card-prices">
                <span class="card-price">${priceDisplay}</span>
                ${p.precio_promo?`<span class="card-promo">${p.precio_promo}</span>`:''}
              </div>
              ${actionHTML(p,inCartQty,hasVariants,stock)}
            </div>
          </div>
        </div>`;
    }
    function actionHTML(p,inCartQty,hasVariants,stock){
      if(!hasVariants&&inCartQty>0){
        return `<div class="qty-control">
            <button data-action="dec" data-id="${p.id}" data-key="${cartKey(p.id,{})}">−</button>
            <span class="qty-val">${inCartQty}</span>
            <button data-action="inc" data-id="${p.id}" ${!stock.canAdd||inCartQty>=stock.maxQty?'disabled':''}>+</button>
          </div>`;
      }
      if(!hasVariants&&!stock.canAdd) return `<button class="btn-add" disabled>Agotado</button>`;
      return `<button class="btn-add icon-only" ${hasVariants?`data-open="${p.id}"`:`data-add="${p.id}"`} aria-label="${hasVariants?'Elegir opciones':'Agregar'}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>`;
    }

    /* ── PROMO BANNER (productos con tipo 'promocion' → banner clickeable → openModal) ── */
    // Aditivo: sin promos devuelve '' y el catálogo se ve idéntico al de siempre.
    function promoBannerHTML(){
      const promos=products.filter(p=>isPromo(p)&&promoActiveToday(p));
      if(!promos.length) return '';
      const slides=promos.map(p=>{
        const img=getImages(p)[0]||'';
        return `<div class="promo-slide${img?'':' no-img'}" data-open="${p.id}" ${img?`style="background-image:url('${img}')"`:''}>
          <div class="promo-shade"></div>
          <div class="promo-content">
            <div class="promo-title">${p.nombre}</div>
            <div class="promo-cta">Ver oferta <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="9 18 15 12 9 6"/></svg></div>
          </div>
        </div>`;
      }).join('');
      const dots=promos.length>1?`<div class="promo-dots" id="promoDots">${promos.map((_,i)=>`<button class="promo-dot${i===0?' active':''}" data-pidx="${i}" aria-label="Promo ${i+1}"></button>`).join('')}</div>`:'';
      return `<div class="promo-banner"><div class="promo-track" id="promoTrack">${slides}</div>${dots}</div>`;
    }
    let promoTimer,promoIdx=0;
    function setupPromoBanner(){
      clearInterval(promoTimer);
      const track=document.getElementById('promoTrack');
      if(!track) return;
      const n=track.children.length;promoIdx=0;
      const go=i=>{
        promoIdx=(i+n)%n;
        track.style.transform=`translateX(-${promoIdx*100}%)`;
        document.querySelectorAll('.promo-dot').forEach((d,k)=>d.classList.toggle('active',k===promoIdx));
      };
      document.getElementById('promoDots')?.addEventListener('click',e=>{const d=e.target.closest('.promo-dot');if(d)go(+d.dataset.pidx);});
      let sx=0;
      track.addEventListener('touchstart',e=>sx=e.changedTouches[0].clientX,{passive:true});
      track.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>40)go(dx<0?promoIdx+1:promoIdx-1);});
      if(n>1) promoTimer=setInterval(()=>go(promoIdx+1),7000);
    }

    /* ── RENDER CATALOG ── */
    function matchSearch(p){
      return !searchQuery||normalize(p.nombre).includes(searchQuery)||normalize(p.descripcion||'').includes(searchQuery);
    }
    function renderFlat(list,title,em,emptyMsg){
      if(!list.length){$catalog.innerHTML=`<div class="empty-state"><span class="em">${em}</span><p>${emptyMsg}</p></div>`;return;}
      $catalog.innerHTML=`<div class="cat-section"><h2 class="cat-header"><span class="em">${em}</span>${title}</h2><div class="grid">${list.map((p,i)=>cardHTML(p,i)).join('')}</div></div>`;
    }
    function renderCatalog(){
      document.body.classList.remove('location-view');
      if(activeFilter==='__favs__'){
        setActiveChip(null);
        renderFlat(products.filter(p=>isFav(p.id)&&matchSearch(p)),'Tus Favoritos','❤️','No tienes favoritos aún.','Toca el ♡ en cualquier producto para guardarlo.');
        return;
      }
      if(activeFilter==='__offers__'){
        setActiveChip(null);
        renderFlat(products.filter(p=>((isPromo(p)&&promoActiveToday(p))||isOffer(p))&&matchSearch(p)),'Ofertas','🏷️','No hay ofertas activas ahora mismo.');
        return;
      }

      const filtered=products.filter(p=>{
        if(isPromo(p)) return false; // promos van solo en el banner, no en el grid
        const matchCat=activeFilter==='all'||(p.categorias||[]).includes(activeFilter);
        return matchCat&&matchSearch(p);
      });
      const groups={};
      filtered.forEach(p=>{const c=(p.categorias||[])[0]||'';(groups[c]=groups[c]||[]).push(p);});

      const catLabels=config.categories||{};
      // Banner de promos: solo en la vista 'all' sin búsqueda (como el hero de la referencia).
      let html=(activeFilter==='all'&&!searchQuery)?promoBannerHTML():'';
      categorySlugs.forEach(cat=>{
        const inCat=groups[cat]||[];
        if(!inCat.length) return;
        html+=`<div class="cat-section" id="cat-${cat}">
          <h2 class="cat-header"><span class="em">${catIcon(cat,catLabels[cat])}</span>${catLabel(catLabels[cat])||cat}</h2>
          <div class="grid">${inCat.map((p,i)=>cardHTML(p,i)).join('')}</div>
        </div>`;
      });
      $catalog.innerHTML=html||`<div class="empty-state"><span class="em">🔍</span><p>No se encontraron productos</p></div>`;
      setActiveChip(activeFilter);
      setupPromoBanner();
      setupIntersectionObserver();
    }

    function renderLocation(){
      document.body.classList.add('location-view');
      if(observer) observer.disconnect();
      const sedes=(config.location&&config.location.sedes)||[];
      const wa=config.location&&config.location.telefono_principal||config.whatsapp_number||'';
      const waNum=wa.replace(/\D/g,'');
      const social=config.social||{};

      const sedeCard=(s,extra='')=>`
        <div class="sede-card${extra}">
          <div class="sede-name">${s.nombre}</div>
          <div class="sede-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1116 0z"/><circle cx="12" cy="10" r="2.5"/></svg>
            <span>${s.direccion}</span>
          </div>
          ${s.telefono?`<div class="sede-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z"/></svg>
            <a href="tel:${s.telefono}">${s.telefono}</a>
          </div>`:''}
          ${waNum?`<div class="sede-row">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            <a href="https://wa.me/${waNum}" target="_blank">+${waNum}</a>
          </div>`:''}
        </div>`;

      // Pair into rows; last one centered if odd
      const pairs=[];
      for(let i=0;i<sedes.length;i+=2) pairs.push(sedes.slice(i,i+2));

      const sedesHTML=pairs.map(pair=>{
        if(pair.length===2) return `<div class="sede-card" style="display:contents">${sedeCard(pair[0])}${sedeCard(pair[1])}</div>`;
        return sedeCard(pair[0],' full');
      }).join('');

      // Actually render all as flat grid items
      const allCards=sedes.map((s,i)=>i===sedes.length-1&&sedes.length%2!==0?sedeCard(s,' full'):sedeCard(s)).join('');

      const socialHTML=(social.facebook||social.instagram||social.tiktok)?`
        <div class="social-section">
          <div class="social-title">Síguenos</div>
          <div class="social-strip">
            ${social.facebook?`<a class="social-btn" href="${social.facebook}" target="_blank" rel="noopener" aria-label="Facebook">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>
            </a>`:''}
            ${social.instagram?`<a class="social-btn" href="${social.instagram}" target="_blank" rel="noopener" aria-label="Instagram">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
            </a>`:''}
            ${social.tiktok?`<a class="social-btn" href="${social.tiktok}" target="_blank" rel="noopener" aria-label="TikTok">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.8a4.85 4.85 0 01-1.07-.11z"/></svg>
            </a>`:''}
          </div>
        </div>`:'';

      const mapEmbed=config.location&&config.location.map_embed;
      const mapHTML=mapEmbed?`<div class="location-map"><iframe src="${mapEmbed}" style="border:0" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin" title="Ubicación"></iframe></div>`:'';

      $catalog.innerHTML=`
        <section class="location-view-wrap">
          <div class="location-heading">
            <h2>📍 Nuestra Ubicación</h2>
            <p>Ven a disfrutar la mejor smash burger artesanal.</p>
          </div>
          <div class="sedes-grid">${allCards}</div>
          ${mapHTML}
          ${socialHTML}
          <div class="location-reserve">
            <h3 class="reserve-heading">📅 Haz una reserva</h3>
            <p class="reserve-subheading">Cuéntanos cuándo vienes y te confirmamos por WhatsApp</p>
            ${reservationFormHTML()}
          </div>
        </section>`;
      setupReserveForm($catalog.querySelector('.location-reserve'));
    }

    function updateCardButtons(){
      document.querySelectorAll('.card').forEach(card=>{
        const id=card.dataset.id,p=products.find(x=>String(x.id)===String(id));
        if(!p) return;
        const inCartQty=cartItems.filter(ci=>String(ci.id)===String(id)).reduce((s,ci)=>s+ci.qty,0);
        const hasVariants=Array.isArray(p.variantes)&&p.variantes.length>0;
        const foot=card.querySelector('.card-foot');if(!foot) return;
        const actionEl=foot.querySelector('.btn-add,.qty-control');
        if(actionEl) actionEl.outerHTML=actionHTML(p,inCartQty,hasVariants,getStockInfo(p));
      });
    }

    /* ── INTERSECTION OBSERVER (sync chip while scrolling in 'all') ── */
    let observer;
    function setupIntersectionObserver(){
      if(observer) observer.disconnect();
      if(activeFilter!=='all'&&activeFilter!=='__none__') return;
      observer=new IntersectionObserver(entries=>{
        entries.forEach(e=>{if(e.isIntersecting) setActiveChip(e.target.id.replace('cat-',''));});
      },{rootMargin:'-25% 0px -65% 0px',threshold:0});
      document.querySelectorAll('.cat-section').forEach(s=>observer.observe(s));
    }

    /* ── PRODUCT MODAL ── */
    function openModal(id){
      const p=products.find(x=>String(x.id)===String(id));if(!p) return;
      modalProduct=p;modalQty=1;modalVariants={};modalDist={};modalRepeat={};modalCombo={};sliderImages=getImages(p);sliderIdx=0;
      $sliderTrack.innerHTML=sliderImages.length
        ?sliderImages.map(src=>`<div class="slider-slide"><img src="${src}" alt="${p.nombre}" loading="lazy"/></div>`).join('')
        :`<div class="slider-slide"><span class="slider-placeholder">${catIcon((p.categorias||[])[0],p.nombre)}</span></div>`;
      $sliderTrack.style.transform='translateX(0)';
      $sliderDots.innerHTML=sliderImages.length>1?sliderImages.map((_,i)=>`<button class="slider-dot${i===0?' active':''}" data-idx="${i}"></button>`).join(''):'';
      $sliderPrev.hidden=$sliderNext.hidden=sliderImages.length<=1;
      $modalFav.dataset.fav=p.id;$modalFav.classList.toggle('active',isFav(p.id));$modalFav.textContent=isFav(p.id)?'♥':'♡';
      renderModalDetail();
      $modalOverlay.classList.add('open');document.body.style.overflow='hidden';
    }
    // Variante-plantilla (repeat) que se clona N veces según la opción de combo elegida.
    // N = "salsas" de la opción seleccionada en cualquier variante no-repeat. null si el
    // producto no usa el mecanismo (retrocompatible: productos normales pasan por aquí sin efecto).
    function repeatInfo(p){
      if(!Array.isArray(p.variantes)) return null;
      const ri=p.variantes.findIndex(v=>v&&v.repeat);
      if(ri<0) return null;
      let n=0;
      for(let i=0;i<p.variantes.length;i++){
        if(i===ri) continue;
        const sel=modalVariants[i];if(sel===undefined) continue;
        const opt=(p.variantes[i].options||[]).find(o=>getOptionKey(o)===sel);
        if(opt&&typeof opt==='object'&&typeof opt.salsas==='number') n=opt.salsas;
      }
      return {ri,n,group:p.variantes[ri]};
    }
    function renderModalDetail(){
      const p=modalProduct;
      const hasVariants=Array.isArray(p.variantes)&&p.variantes.length>0;
      const stock=getStockInfo(p);
      const dist=distGroup(p);
      const distSum=dist?dist.group.options.reduce((s,o)=>s+(modalDist[getOptionKey(o)]||0),0):0;
      const rep=repeatInfo(p);
      if(rep) Object.keys(modalRepeat).forEach(k=>{if(+k>=rep.n) delete modalRepeat[k];}); // recorta si baja N
      const combo=comboInfo(p);
      const comboMap=()=>{const m={};if(combo)for(let k=0;k<combo.pick;k++)if(modalCombo[k])m['c'+k]=modalCombo[k];return m;};
      const staticOK=!hasVariants||p.variantes.every((g,i)=>(rep&&i===rep.ri)||g.optional||modalVariants[i]);
      const repeatOK=!rep||rep.n===0||Array.from({length:rep.n}).every((_,k)=>modalRepeat[k]);
      const comboOK=!combo||Array.from({length:combo.pick}).every((_,k)=>modalCombo[k]);
      const allSelected=!hasVariants||(dist?distSum===dist.total:(combo?comboOK:staticOK&&repeatOK));
      // El combo muestra precio parcial (suma-menos-baratas) según lo ya elegido.
      const effPrice=combo?getEffectivePrice(p,comboMap()):(allSelected&&!dist?getEffectivePrice(p,modalVariants):parsePrice(p));
      const canAddModal=stock.canAdd&&allSelected;

      let variantHTML='';
      if(dist){
        variantHTML='<div class="customize-label">Personaliza</div>'+
          `<div class="variant-group"><div class="variant-glabel">${dist.group.name||'Sabores'} — ${distSum}/${dist.total}</div>`+
          dist.group.options.map(opt=>{
            const k=getOptionKey(opt),c=modalDist[k]||0;
            return `<div class="dist-row"><span class="dist-name">${getOptionDisplay(opt)}</span>
              <div class="modal-qty dist-ctrl">
                <button class="dist-btn" data-dopt="${k}" data-dd="-1" ${c<=0?'disabled':''}>−</button>
                <span class="qty-val">${c}</span>
                <button class="dist-btn" data-dopt="${k}" data-dd="1" ${distSum>=dist.total?'disabled':''}>+</button>
              </div></div>`;
          }).join('')+`</div>`;
      } else if(hasVariants){
        // opt.label already has price embedded (from processVariants price_select) — don't add it again
        const optLabel=opt=>{const d=getOptionDisplay(opt),pr=getOptionPrice(opt);return(pr!==null&&typeof opt==='string')?`${d} (${formatPrice(pr)})`:d;};
        // Renderiza un grupo de opciones: select si >4, botones si no. `attr` cablea el estado
        // (data-group-idx para variantes normales, data-repeat-k para las clonadas).
        const groupHTML=(glabel,attr,options,cur)=>options.length>4
          ?`<div class="variant-group"><div class="variant-glabel">${glabel}</div>
              <select class="variant-select" ${attr}>
                <option value="">— Elige una opción —</option>
                ${options.map(opt=>{const k=getOptionKey(opt);return`<option value="${k}"${cur===k?' selected':''}>${optLabel(opt)}</option>`;}).join('')}
              </select></div>`
          :`<div class="variant-group"><div class="variant-glabel">${glabel}</div>
              <div class="variant-options">
                ${options.map(opt=>{const oKey=getOptionKey(opt);return`<button class="variant-option${cur===oKey?' selected':''}" ${attr} data-opt="${oKey}">${optLabel(opt)}</button>`;}).join('')}
              </div></div>`;
        if(combo){
          let comboHTML='';
          for(let k=0;k<combo.pick;k++) comboHTML+=groupHTML(`${combo.item} ${k+1}`,`data-combo-k="${k}"`,combo.g.options,modalCombo[k]||'');
          variantHTML='<div class="customize-label">Personaliza</div>'+comboHTML;
        } else {
        const staticHTML=p.variantes.map((g,idx)=>
          (rep&&idx===rep.ri)?'':groupHTML(g.name||'Opciones',`data-group-idx="${idx}"`,g.options,modalVariants[idx]||'')
        ).join('');
        // Selectores clonados de la plantilla (rep.n copias, "Salsa 1..N").
        let repeatHTML='';
        if(rep&&rep.n>0){
          const base=rep.group.name||'Salsa';
          for(let k=0;k<rep.n;k++) repeatHTML+=groupHTML(`${base} ${k+1}`,`data-repeat-k="${k}"`,rep.group.options,modalRepeat[k]||'');
        }
        variantHTML='<div class="customize-label">Personaliza</div>'+staticHTML+repeatHTML;
        }
      }

      $modalDetail.innerHTML=`
        <div class="modal-name">${p.nombre}</div>
        <div class="modal-prices">
          <div class="modal-price">${formatPrice(effPrice)}</div>
          ${p.precio_promo?`<div class="modal-promo">${p.precio_promo}</div>`:''}
        </div>
        ${stock.badge?`<div><span class="modal-stock-badge ${stock.cls}">${stock.badge}</span></div>`:''}
        ${p.descripcion?`<div class="modal-desc">${p.descripcion}</div>`:''}
        ${variantHTML}
        ${hasVariants&&!allSelected?`<p class="modal-variant-hint">${dist?`Reparte ${dist.total} — faltan ${dist.total-distSum}`:(combo?`Elige ${combo.pick} ${combo.item.toLowerCase()}s`:'Selecciona todas las opciones')}</p>`:''}
        ${!stock.canAdd&&allSelected?'<p class="modal-stock-hint">Producto agotado</p>':''}
        <div class="modal-actions">
          <div class="modal-qty">
            <button id="mqDec">−</button>
            <span class="qty-val" id="mqVal">${modalQty}</span>
            <button id="mqInc" ${!stock.canAdd||modalQty>=stock.maxQty?'disabled':''}>+</button>
          </div>
          <button class="btn-modal-add" id="btnModalAdd" ${!canAddModal?'disabled':''}>
            ${stock.canAdd?`Agregar · ${formatPrice(effPrice*modalQty)}`:'Agotado'}
          </button>
        </div>`;

      document.getElementById('mqDec').addEventListener('click',()=>{if(modalQty>1){modalQty--;renderModalDetail();}});
      document.getElementById('mqInc').addEventListener('click',()=>{
        if(modalQty>=stock.maxQty){showToast('Stock insuficiente');return;}
        modalQty++;renderModalDetail();
      });
      document.getElementById('btnModalAdd').addEventListener('click',()=>{
        let v=modalVariants;
        if(dist){
          const label=dist.group.options.filter(o=>modalDist[getOptionKey(o)]>0)
            .map(o=>`${getOptionDisplay(o)} x${modalDist[getOptionKey(o)]}`).join(' · ');
          v={[dist.group.name]:label};
        } else if(rep&&rep.n>0){
          v=Object.assign({},modalVariants);
          const base=rep.group.name||'Salsa';
          for(let k=0;k<rep.n;k++) v['r'+k]=`${base} ${k+1}: ${modalRepeat[k]}`;
        } else if(combo){
          v={};for(let k=0;k<combo.pick;k++) v['c'+k]=modalCombo[k];
        }
        cartAdd(modalProduct.id,v,modalQty);closeModal();
      });
      $modalDetail.querySelectorAll('.dist-btn').forEach(btn=>btn.addEventListener('click',()=>{
        const k=btn.dataset.dopt,dd=+btn.dataset.dd,next=(modalDist[k]||0)+dd;
        if(next<0||(dd>0&&distSum>=dist.total)) return;
        modalDist[k]=next;renderModalDetail();
      }));
      $modalDetail.querySelectorAll('.variant-option').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const opt=btn.dataset.opt;
          if(btn.dataset.comboK!==undefined){
            const k=+btn.dataset.comboK;
            if(modalCombo[k]===opt) delete modalCombo[k]; else modalCombo[k]=opt;
            renderModalDetail();return;
          }
          if(btn.dataset.repeatK!==undefined){
            const k=+btn.dataset.repeatK;
            if(modalRepeat[k]===opt) delete modalRepeat[k]; else modalRepeat[k]=opt;
            renderModalDetail();return;
          }
          const idx=+btn.dataset.groupIdx;
          if(modalVariants[idx]===opt) delete modalVariants[idx];
          else{
            modalVariants[idx]=opt;
            const _o=((modalProduct.variantes[idx]||{}).options||[]).find(o=>getOptionKey(o)===opt);
            if(_o&&_o.image){const _i=sliderImages.indexOf(_o.image);if(_i>=0)slideTo(_i);}
          }
          renderModalDetail();
        });
      });
      $modalDetail.querySelectorAll('.variant-select').forEach(sel=>{
        sel.addEventListener('change',()=>{
          if(sel.dataset.comboK!==undefined){
            const k=+sel.dataset.comboK;
            if(sel.value) modalCombo[k]=sel.value; else delete modalCombo[k];
            renderModalDetail();return;
          }
          if(sel.dataset.repeatK!==undefined){
            const k=+sel.dataset.repeatK;
            if(sel.value) modalRepeat[k]=sel.value; else delete modalRepeat[k];
            renderModalDetail();return;
          }
          const idx=+sel.dataset.groupIdx;
          if(sel.value) modalVariants[idx]=sel.value; else delete modalVariants[idx];
          renderModalDetail();
        });
      });
    }
    function closeModal(){$modalOverlay.classList.remove('open');document.body.style.overflow='';modalProduct=null;}

    /* ── SLIDER ── */
    function slideTo(idx){
      if(sliderImages.length<=1) return;
      sliderIdx=Math.max(0,Math.min(idx,sliderImages.length-1));
      $sliderTrack.style.transform=`translateX(-${sliderIdx*100}%)`;
      $sliderDots.querySelectorAll('.slider-dot').forEach((d,i)=>d.classList.toggle('active',i===sliderIdx));
    }
    $sliderPrev.addEventListener('click',e=>{e.stopPropagation();slideTo(sliderIdx-1);});
    $sliderNext.addEventListener('click',e=>{e.stopPropagation();slideTo(sliderIdx+1);});
    $sliderDots.addEventListener('click',e=>{const d=e.target.closest('.slider-dot');if(d) slideTo(Number(d.dataset.idx));});
    let touchStartX=0;
    const $sw=document.getElementById('sliderWrap');
    $sw.addEventListener('touchstart',e=>{touchStartX=e.changedTouches[0].clientX;},{passive:true});
    $sw.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchStartX;if(Math.abs(dx)>40) slideTo(dx<0?sliderIdx+1:sliderIdx-1);});

    /* ── CART UI ── */
    function updateCartUI(){
      const qty=cartTotalQty(),fee=packagingFee(currentMode()),total=cartTotalPrice()+fee;
      $navBadge.textContent=qty;$navBadge.classList.toggle('show',qty>0);
      $peekCount.textContent=qty;$peekTotal.textContent=formatPrice(total);
      const sheetOpen=$cartDrawer.classList.contains('open');
      $cartPeek.classList.toggle('show',qty>0&&!sheetOpen);
      $cartTotal.textContent=formatPrice(total);
      $cartItemCount.textContent=`${qty} item(s) · ${cartItems.length} producto(s)`;
      $btnCheckout.disabled=qty===0||storeClosed;

      // Línea de empaque en el footer (creada al vuelo; el HTML del cliente no la trae).
      let feeLine=document.getElementById('cartFeeLine');
      const footer=$cartTotal.closest('.cart-footer');
      if(fee>0&&qty>0){
        if(!feeLine&&footer){feeLine=document.createElement('div');feeLine.id='cartFeeLine';feeLine.className='cart-fee';footer.insertBefore(feeLine,footer.firstChild);}
        if(feeLine) feeLine.innerHTML=`<span>${(config.packaging&&config.packaging.label)||'Empaque'}</span><span>${formatPrice(fee)}</span>`;
      }else if(feeLine){feeLine.remove();}

      renderCrossSell();

      if(!cartItems.length){
        $cartItems.innerHTML=`<div class="cart-empty"><span class="em">🛒</span><p>Tu pedido está vacío</p></div>`;
        return;
      }
      $cartItems.innerHTML=cartItems.map(item=>{
        const vLabel=variantLabel(item.variantes);
        return `<div class="cart-item">
          ${item.imagen?`<img src="${item.imagen}" alt="${item.nombre}" loading="lazy"/>`:`<div class="ph">🍽️</div>`}
          <div class="cart-item-info">
            <div class="cart-item-name">${item.nombre}</div>
            ${vLabel?`<div class="cart-item-variant">${vLabel}</div>`:''}
            <div class="cart-item-detail">${item.qty} × ${formatPrice(item.precio)} = ${formatPrice(item.precio*item.qty)}</div>
          </div>
          <button class="cart-item-remove" data-key="${item.key}" title="Quitar">✕</button>
        </div>`;
      }).join('');
    }

    /* ── CROSS-SELL (opt-in por config.cross_sell; tira de sugeridos en el carrito) ──
       {categories:[slug],title,max}. Muestra productos de esas categorías que no estén ya
       en el carrito ni agotados. Tap: simple → agrega; con variantes → abre el modal. */
    function renderCrossSell(){
      const cfg=config.cross_sell,cats=cfg&&Array.isArray(cfg.categories)?cfg.categories:[];
      let box=document.getElementById('crossSell');
      const footer=$cartTotal.closest('.cart-footer');
      if(!cats.length||!cartItems.length||!footer){ if(box) box.remove(); return; }
      const inCart=new Set(cartItems.map(ci=>String(ci.id)));
      const pool=products.filter(p=>(p.categorias||[]).some(c=>cats.includes(c))&&!inCart.has(String(p.id))&&getStockInfo(p).canAdd);
      const items=pool.slice(0,cfg.max||6);
      if(!items.length){ if(box) box.remove(); return; }
      if(!box){ box=document.createElement('div');box.id='crossSell';box.className='cross-sell';footer.parentNode.insertBefore(box,footer); }
      box.innerHTML=`<div class="cross-sell-title">${cfg.title||'¿Algo más?'}</div><div class="cross-sell-strip">`+
        items.map(p=>{
          const hasV=Array.isArray(p.variantes)&&p.variantes.length>0,img=getImages(p)[0];
          const price=typeof p.precio==='number'?formatPrice(p.precio):(p.precio||'');
          return `<button class="xs-card" ${hasV?`data-open="${p.id}"`:`data-add="${p.id}"`} aria-label="Agregar ${p.nombre}">
            ${img?`<img src="${img}" alt="${p.nombre}" loading="lazy"/>`:`<div class="xs-ph">🍽️</div>`}
            <div class="xs-name">${p.nombre}</div>
            <div class="xs-foot"><span class="xs-price">${price}</span><span class="xs-add">+</span></div>
          </button>`;
        }).join('')+`</div>`;
    }
    function openCart(){$cartOverlay.classList.add('open');$cartDrawer.classList.add('open');document.body.style.overflow='hidden';setActiveNav('cart');$cartPeek.classList.remove('show');}
    function closeCart(){$cartOverlay.classList.remove('open');$cartDrawer.classList.remove('open');document.body.style.overflow='';syncNavToFilter();updateCartUI();goToStep1();}

    /* ── CHECKOUT STEPS ── */
    function goToStep1(){
      $cartItems.style.display='';
      document.querySelector('.cart-footer').style.display='';
      document.getElementById('cartStep2').style.display='none';
      document.getElementById('cartTitle').textContent='Tu Pedido';
      document.getElementById('cartBack').style.display='none';
    }
    function goToStep2(){
      if(!cartItems.length) return;
      if(storeClosed){showToast((config.hours&&config.hours.closed_msg)||'Estamos cerrados ahora');return;}
      $cartItems.style.display='none';
      document.querySelector('.cart-footer').style.display='none';
      document.getElementById('cartStep2').style.display='flex';
      document.getElementById('cartTitle').textContent='Datos de entrega';
      document.getElementById('cartBack').style.display='';
    }

    /* ── WHATSAPP CHECKOUT ── */
    function checkout(){
      const num=(config.whatsapp_number||'').replace(/\D/g,'');
      if(!num){showToast('WhatsApp no configurado');return;}
      const name=document.getElementById('fieldName').value.trim();
      const phone=document.getElementById('fieldPhone').value.trim();
      const mode=document.querySelector('.dtog-btn.active')?.dataset.mode||'delivery';
      const address=mode==='delivery'?document.getElementById('fieldAddress').value.trim():'';
      if(!name||!phone){showToast('Completa tu nombre y teléfono');return;}
      if(mode==='delivery'&&!address){showToast('Ingresa tu dirección de entrega');return;}
      if(storeClosed){showToast((config.hours&&config.hours.closed_msg)||'Estamos cerrados ahora');return;}
      const fee=packagingFee(mode),cur=config.currency||'$',store=config.store_name||'Catálogo';
      const total=cartTotalPrice()+fee;
      const pkgLabel=(config.packaging&&config.packaging.label)||'Empaque';

      // Notifica al dueño antes de abrir WA — fire-and-forget. El empaque va como ítem extra.
      if(config.catalog_notify_url&&config.catalog_notify_token){
        const notifyItems=cartItems.map(i=>({nombre:i.nombre,qty:i.qty,precio:i.precio,variant:variantLabel(i.variantes)||undefined}));
        if(fee>0) notifyItems.push({nombre:pkgLabel,qty:1,precio:fee});
        fetch(config.catalog_notify_url,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            token:config.catalog_notify_token,
            store_name:store,
            items:notifyItems,
            total,currency:cur,
            client_name:name,client_phone:phone,
            delivery_mode:mode,address:address||undefined,
            store_url:location.href
          })
        }).catch(()=>{});
      }

      let msg=`${config.whatsapp_message||'¡Hola! Quiero hacer un pedido:'}\n\n*PEDIDO — ${store}*\n━━━━━━━━━━━━━━━━━\n`;
      cartItems.forEach(item=>{
        const vLabel=variantLabel(item.variantes);
        msg+=`▸ ${item.nombre}${vLabel?' ('+vLabel+')':''}\n  ${item.qty} × ${formatPrice(item.precio)} = ${formatPrice(item.precio*item.qty)}\n`;
      });
      if(fee>0) msg+=`▸ ${pkgLabel}\n  ${formatPrice(fee)}\n`;
      msg+=`━━━━━━━━━━━━━━━━━\n*TOTAL: ${cur}${total.toFixed(2)}*\n\n`;
      msg+=`*ENTREGA:* ${mode==='delivery'?'Domicilio':'Retiro en local'}\n`;
      msg+=`*Cliente:* ${name}\n*Teléfono:* ${phone}\n`;
      if(address) msg+=`*Dirección:* ${address}\n`;
      msg+=`\n${location.href}`;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`,'_blank');
    }

    /* ── BOTTOM NAV ── */
    function setActiveNav(name){document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.nav===name));}
    function syncNavToFilter(){
      setActiveNav(activeFilter==='__offers__'?'offers':activeFilter==='__location__'?'location':'home');
    }
    function goTop(){window.scrollTo({top:0,behavior:'smooth'});}
    document.querySelector('.bottom-nav').addEventListener('click',e=>{
      const item=e.target.closest('.nav-item');if(!item) return;
      const nav=item.dataset.nav;
      if(nav==='cart'){openCart();return;}
      searchQuery='';$searchInput.value='';
      activeFilter=nav==='offers'?'__offers__':nav==='location'?'__location__':'all';
      setActiveNav(nav);
      if(nav==='location') renderLocation(); else renderCatalog();
      goTop();
    });
    $cartPeek.addEventListener('click',openCart);

    /* ── EVENT DELEGATION ── */
    document.addEventListener('click',e=>{
      const favBtn=e.target.closest('[data-fav]');
      if(favBtn){e.stopPropagation();toggleFav(favBtn.dataset.fav);return;}

      const addTrigger=e.target.closest('[data-add]');
      if(addTrigger&&!e.target.closest('[data-action]')){
        const p=products.find(x=>String(x.id)===String(addTrigger.dataset.add));
        if(p&&getStockInfo(p).canAdd) cartAdd(addTrigger.dataset.add,{},1);
        return;
      }
      const openTrigger=e.target.closest('[data-open]');
      if(openTrigger&&!e.target.closest('[data-action]')){openModal(openTrigger.dataset.open);return;}

      const btn=e.target.closest('[data-action]');
      if(btn){
        const {action,id,key}=btn.dataset;
        if(action==='inc'){const p=products.find(x=>String(x.id)===String(id));if(p&&getStockInfo(p).canAdd) cartAdd(id,{},1);}
        if(action==='dec'&&key) cartRemoveOne(key);
        return;
      }
      const removeBtn=e.target.closest('.cart-item-remove');
      if(removeBtn){cartDelete(removeBtn.dataset.key);return;}
    });

    $catStrip.addEventListener('click',e=>{
      const chip=e.target.closest('.cat-chip');if(!chip) return;
      const cat=chip.dataset.cat;
      searchQuery='';$searchInput.value='';
      activeFilter=cat;setActiveNav('home');renderCatalog();
      if(cat!=='all') requestAnimationFrame(()=>{const s=document.getElementById('cat-'+cat);if(s) s.scrollIntoView({behavior:'smooth'});});
      else goTop();
    });

    $searchInput.addEventListener('input',()=>{
      searchQuery=normalize($searchInput.value);
      if(activeFilter==='__offers__'||activeFilter==='__favs__'){renderCatalog();return;}
      activeFilter='all';setActiveNav('home');renderCatalog();
    });

    $cartOverlay.addEventListener('click',closeCart);
    $cartClose.addEventListener('click',closeCart);
    $btnCheckout.addEventListener('click',goToStep2);
    document.getElementById('cartBack').addEventListener('click',goToStep1);
    document.getElementById('btnConfirm').addEventListener('click',checkout);
    document.getElementById('deliveryToggle').addEventListener('click',e=>{
      const btn=e.target.closest('.dtog-btn');if(!btn) return;
      document.querySelectorAll('.dtog-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('fieldAddressWrap').style.display=btn.dataset.mode==='delivery'?'':'none';
      updateCartUI(); // el empaque solo aplica a domicilio → recalcula total
    });
    $modalOverlay.addEventListener('click',e=>{if(e.target===$modalOverlay) closeModal();});
    $modalClose.addEventListener('click',closeModal);
    $modalFav.addEventListener('click',()=>toggleFav($modalFav.dataset.fav));
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){closeModal();closeCart();}
      if($modalOverlay.classList.contains('open')){
        if(e.key==='ArrowLeft') slideTo(sliderIdx-1);
        if(e.key==='ArrowRight') slideTo(sliderIdx+1);
      }
    });

    /* ── HORARIO CERRADO MODAL + RESERVAS ── */
    function buildTimeSlots(dayIdx){
      const weekly=(config.hours&&config.hours.weekly)||{};
      const ranges=weekly[dayIdx]||[];
      const toMin=s=>{const[a,b]=String(s).split(':');return(+a)*60+(+b||0);};
      const fmt=m=>{const hh=Math.floor(m/60)%24,mm=m%60;return`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;};
      const slots=[];
      ranges.forEach(r=>{let s=toMin(r[0]),e=toMin(r[1]);if(e<=s)e+=1440;for(let t=s;t<e;t+=30)slots.push(fmt(t%1440));});
      if(!slots.length)for(let t=480;t<=1320;t+=30)slots.push(fmt(t)); // ponytail: fallback 08:00-22:00 si no hay config de horario
      return slots;
    }
    function reservationFormHTML(){
      const days=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
      const weekly=(config.hours&&config.hours.weekly)||{};
      const configured=Object.entries(weekly).filter(([,r])=>r&&r.length).map(([d])=>+d);
      const dayOpts=(configured.length?configured:[0,1,2,3,4,5,6]).map(d=>`<option value="${d}">${days[d]}</option>`).join('');
      return `<div class="reserve-form">
        <div class="form-field"><label>Nombre y apellido</label>
          <input type="text" class="res-name" placeholder="Tu nombre completo" autocomplete="name"/></div>
        <div class="form-field"><label>WhatsApp</label>
          <input type="tel" class="res-phone" placeholder="Tu número de WhatsApp" autocomplete="tel"/></div>
        <div class="reserve-row">
          <div class="form-field"><label>Día</label><select class="res-day">${dayOpts}</select></div>
          <div class="form-field"><label>Hora</label><select class="res-time"></select></div>
        </div>
        <div class="form-field"><label>¿Cuántas personas?</label>
          <input type="number" class="res-people" min="1" step="1" value="2" inputmode="numeric"/></div>
        <div class="form-field"><label>¿Celebran algo especial? (opcional)</label>
          <input type="text" class="res-occasion" placeholder="Cumpleaños, aniversario…"/></div>
        <button class="btn-reserve-submit">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Confirmar reserva
        </button>
      </div>`;
    }
    function setupReserveForm(container){
      const dayEl=container.querySelector('.res-day'),timeEl=container.querySelector('.res-time');
      const fillSlots=()=>{const s=buildTimeSlots(+dayEl.value);timeEl.innerHTML=s.map(t=>`<option>${t}</option>`).join('');};
      dayEl.addEventListener('change',fillSlots);fillSlots();
      container.querySelector('.btn-reserve-submit').addEventListener('click',()=>{
        const name=container.querySelector('.res-name').value.trim();
        const phone=container.querySelector('.res-phone').value.trim();
        if(!name||!phone){showToast('Completa nombre y WhatsApp');return;}
        const num=(config.whatsapp_number||'').replace(/\D/g,'');
        if(!num){showToast('WhatsApp no configurado');return;}
        const day=dayEl.options[dayEl.selectedIndex].text,time=timeEl.value;
        const people=(container.querySelector('.res-people').value||'').trim();
        const occasion=container.querySelector('.res-occasion').value.trim();
        const store=config.store_name||'el local';
        let msg=`¡Hola! Quiero hacer una *reserva* en ${store}:\n\n*Nombre:* ${name}\n*WhatsApp:* ${phone}\n*Día:* ${day}\n*Hora:* ${time}`;
        if(people) msg+=`\n*Personas:* ${people}`;
        if(occasion) msg+=`\n*Ocasión:* ${occasion}`;
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`,'_blank');
      });
    }
    function openClosedModal(){
      if(document.getElementById('closedOverlay')) return;
      const el=document.createElement('div');
      el.id='closedOverlay';el.className='closed-overlay';
      el.innerHTML=`<div class="closed-modal">
        <div class="closed-icon">🌙</div>
        <h2 class="closed-title">Estamos cerrados</h2>
        <p class="closed-msg">${(config.hours&&config.hours.closed_msg)||'Vuelve en nuestro horario de atención.'}</p>
        <p class="closed-sub">Arma tu pedido ahora — lo despachamos en cuanto abramos 🚀</p>
        <div class="closed-btns">
          <button class="btn-closed-browse">Ten mi pedido listo</button>
          <button class="btn-closed-reserve">📅 Hacer una reserva</button>
        </div>
        <div class="closed-reserve-wrap" style="display:none">${reservationFormHTML()}</div>
      </div>`;
      document.body.appendChild(el);
      el.querySelector('.btn-closed-browse').addEventListener('click',()=>el.classList.remove('open'));
      el.querySelector('.btn-closed-reserve').addEventListener('click',()=>{
        const w=el.querySelector('.closed-reserve-wrap');w.style.display=w.style.display==='none'?'':'none';
      });
      setupReserveForm(el.querySelector('.closed-reserve-wrap'));
      requestAnimationFrame(()=>el.classList.add('open'));
    }

    /* ── INIT ── */
    async function init(){
      // Edge (Worker SSR): el config viene inyectado en el HTML → sin fetch, sin flash.
      // Legacy (Pages estático): cae al fetch de config.json. Retrocompatible.
      if(window.__CONFIG__){ config=window.__CONFIG__; }
      else{ try{const r=await fetch('config.json',{cache:'no-store'});if(r.ok) config=await r.json();}catch(e){} }

      // Tema: aplica tokens de config.theme (objeto) + claves legacy theme_primary/accent.
      // El esqueleto (catalog.css) consume estas CSS vars; lo que un token no cubra va en theme.css.
      const root=document.documentElement.style;
      const T={primary:'--primary',accent:'--accent',bg:'--bg',surface:'--surface',surface2:'--surface2',
        text:'--text',text2:'--text2',text3:'--text3',border:'--border',radius:'--radius',font:'--font',
        card_blur:'--card-blur',card_alpha:'--card-alpha'};
      const theme={...(config.theme||{})};
      if(config.theme_primary&&theme.primary==null) theme.primary=config.theme_primary;
      if(config.theme_accent&&theme.accent==null) theme.accent=config.theme_accent;
      for(const k in theme){ if(T[k]&&theme[k]!=null&&theme[k]!=='') root.setProperty(T[k],theme[k]); }

      const store=config.store_name||'Catálogo';
      document.getElementById('brandName').textContent=store;
      // Logo desde config (shell genérico del Worker edge). Legacy trae el src en el index → no lo pisa si config.logo está vacío.
      const brandLogo=document.getElementById('brandLogo');
      if(brandLogo&&config.logo) brandLogo.src=config.logo;
      document.title=config.site_title||store;
      document.getElementById('footerText').innerHTML=
        `© ${new Date().getFullYear()} <strong>${store}</strong>`+
        `<span class="footer-sep">|</span><a href="#" id="lnkTerms">Términos y condiciones</a>`+
        `<span class="footer-sep">|</span><a href="#" id="lnkPrivacy">Política de privacidad</a>`+
        `<br><span class="footer-credit">Powered by <a href="https://craftmarketing.agency" target="_blank" rel="noopener">Craft Systems</a></span>`;
      if(config.hero_title) document.getElementById('heroTitle').innerHTML=config.hero_title;

      // Personalizaciones opcionales desde config (edge y legacy). Si la clave no está,
      // se respeta lo que traiga el index del cliente (retrocompat). Crea el elemento si falta.
      const heroTitle=document.getElementById('heroTitle');
      const beforeHero=el=>{ if(heroTitle) heroTitle.parentNode.insertBefore(el,heroTitle); };
      if(config.fonts && !document.querySelector(`link[href="${config.fonts}"]`)){
        const l=document.createElement('link'); l.rel='stylesheet'; l.href=config.fonts; document.head.appendChild(l);
      }
      if(config.favicon){
        let ic=document.querySelector('link[rel="icon"]');
        if(!ic){ ic=document.createElement('link'); ic.rel='icon'; document.head.appendChild(ic); }
        ic.href=config.favicon;
      }
      if(config.brand_sub){ const bs=document.querySelector('.brand-sub'); if(bs) bs.textContent=config.brand_sub; }
      if(config.hero_kicker){
        let k=document.querySelector('.hero-kicker');
        if(!k){ k=document.createElement('p'); k.className='hero-kicker'; beforeHero(k); }
        k.textContent=config.hero_kicker;
      }
      if(config.hero_divider && !document.querySelector('.hero-divider')){
        const d=document.createElement('div'); d.className='hero-divider'; beforeHero(d);
      }
      if(config.search_placeholder){ const si=document.getElementById('searchInput'); if(si) si.placeholder=config.search_placeholder; }

      // Burbuja de WhatsApp: número dinámico desde config (no hardcodear en el index).
      const waFloat=document.querySelector('.wa-float'),waBubble=(config.whatsapp_number||'').replace(/\D/g,'');
      if(waFloat){
        if(waBubble) waFloat.href=`https://wa.me/${waBubble}?text=${encodeURIComponent(config.whatsapp_message||'¡Hola! Quiero hacer un pedido:')}`;
        else waFloat.style.display='none';
      }

      const mu=config.min_units,md=config.min_days_advance;
      if(mu||md){
        const parts=[];
        if(mu) parts.push(`Mín. <strong>${mu} unidades</strong>`);
        if(md) parts.push(`con <strong>${md} días</strong> de anticipación`);
        const $n=document.getElementById('heroNotice');
        $n.innerHTML=parts.join(', ')+'.';$n.style.display='inline-block';
      }

      // Horario de atención: fuera de hora se bloquea el checkout (se sigue pudiendo navegar).
      storeClosed=!storeHoursOpen(config.hours);
      if(storeClosed) openClosedModal();

      const res=await fetch('productos.json',{cache:'no-store'});
      products=await res.json();

      buildCatStrip();
      loadCart();loadFavs();
      cartItems=cartItems.filter(ci=>products.find(p=>String(p.id)===String(ci.id)));

      renderCatalog();updateCartUI();

      const preOpen=new URLSearchParams(location.search).get('producto');
      if(preOpen){const p=products.find(x=>x.slug===preOpen||String(x.id)===preOpen);if(p) openModal(p.id);}

      // Legal modal
      document.getElementById('lnkTerms')?.addEventListener('click',e=>{e.preventDefault();openLegal('terms');});
      document.getElementById('lnkPrivacy')?.addEventListener('click',e=>{e.preventDefault();openLegal('privacy');});
      document.getElementById('legalClose')?.addEventListener('click',()=>document.getElementById('legalOverlay').classList.remove('open'));
      document.getElementById('legalOverlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget) e.currentTarget.classList.remove('open');});
    }

    function openLegal(type){
      const overlay=document.getElementById('legalOverlay');
      const title=document.getElementById('legalTitle');
      const body=document.getElementById('legalBody');
      const store=config.store_name||'el local';
      const wa=(config.whatsapp_number||'').replace(/\D/g,'');
      if(type==='terms'){
        title.textContent='Términos y condiciones';
        body.innerHTML=`<h4>1. Uso del menú digital</h4>
          <p>Este menú digital es una herramienta informativa de ${store} para facilitar la recepción de pedidos a través de WhatsApp. La realización del pedido implica la aceptación de estos términos.</p>
          <h4>2. Pedidos y pagos</h4>
          <p>Los pedidos se confirman únicamente a través de WhatsApp. Los precios están expresados en dólares americanos (USD) e incluyen IVA. ${store} se reserva el derecho de modificar precios sin previo aviso.</p>
          <h4>3. Entrega</h4>
          <p>El tiempo de entrega es estimado y puede variar según la demanda y la distancia. El costo de envío se acordará directamente con el cliente al confirmar el pedido.</p>
          <h4>4. Cancelaciones</h4>
          <p>Una vez confirmado el pedido por WhatsApp, la cancelación queda sujeta a la aprobación del local. Los pedidos en proceso de preparación no admiten cancelación.</p>
          <h4>5. Disponibilidad</h4>
          <p>La disponibilidad de productos está sujeta al stock del local. ${store} no garantiza la disponibilidad de todos los productos en todo momento.</p>`;
      } else {
        title.textContent='Política de privacidad';
        body.innerHTML=`<h4>1. Datos recopilados</h4>
          <p>Al realizar un pedido, recopilamos: nombre completo, número de teléfono y dirección de entrega. Estos datos se utilizan exclusivamente para procesar y entregar tu pedido.</p>
          <h4>2. Uso de los datos</h4>
          <p>Los datos personales proporcionados no serán vendidos, cedidos ni compartidos con terceros ajenos a ${store}, salvo requerimiento legal.</p>
          <h4>3. WhatsApp</h4>
          <p>La comunicación se realiza a través de WhatsApp. Al contactarnos, aceptas los términos y la política de privacidad de WhatsApp (Meta Platforms, Inc.).</p>
          <h4>4. Cookies</h4>
          <p>Este sitio utiliza localStorage del navegador únicamente para recordar el contenido de tu carrito y tus favoritos. No utilizamos cookies de seguimiento ni publicidad.</p>
          <h4>5. Contacto</h4>
          <p>Para cualquier consulta sobre tus datos, contáctanos al WhatsApp${wa?' +'+wa:''}.</p>`;
      }
      overlay.classList.add('open');
    }

    init().catch(err=>{
      console.error(err);
      $catalog.innerHTML='<div class="empty-state"><span class="em">⚠️</span><p>Error cargando catálogo</p></div>';
    });
  })();
