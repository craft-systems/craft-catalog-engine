/* Eventos web de menú: IDs públicos, sin teléfono/nombre/dirección. */
(function(root){
  'use strict';
  const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
  const validGTM=id=>typeof id==='string'&&/^GTM-[A-Z0-9]+$/.test(id);
  let cfg={};
  function script(src){ if(!document.querySelector(`script[src="${src}"]`)){const s=document.createElement('script');s.async=true;s.src=src;document.head.append(s);} }
  function loadGTM(){const id=cfg.gtm_container_id;if(!validGTM(id)||root.__craftGtmLoaded)return;root.__craftGtmLoaded=true;(root.dataLayer=root.dataLayer||[]).push({'gtm.start':Date.now(),event:'gtm.js'});script(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);}
  function loadMeta(){const id=cfg.meta_pixel_id;if(!valid(id)||root.__craftMetaPixelID===id)return;if(!root.fbq){const q=function(){q.callMethod?q.callMethod.apply(q,arguments):q.queue.push(arguments)};q.queue=[];q.loaded=true;root.fbq=q;script('https://connect.facebook.net/en_US/fbevents.js');}root.fbq('init',id);root.__craftMetaPixelID=id;root.fbq('track','PageView');}
  function loadTikTok(){
    const id=cfg.tiktok_pixel_id;if(!valid(id)||root.__craftTikTokPixelID===id)return;
    const q=root.ttq=root.ttq||[];
    if(!q.load){
      q.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];
      q.setAndDefer=(target,name)=>{target[name]=function(){target.push([name].concat([].slice.call(arguments)));};};
      q.methods.forEach(name=>q.setAndDefer(q,name));
      q.load=pixel=>{q._i=q._i||{};q._i[pixel]=q._i[pixel]||{};q._t=q._t||{};q._t[pixel]=Date.now();q._o=q._o||{};q._o[pixel]={};script(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixel)}&lib=ttq`);};
    }
    q.load(id);q.page();root.__craftTikTokPixelID=id;
  }
  function configure(next){cfg=next&&typeof next==='object'?next:{};loadGTM();loadMeta();loadTikTok();return valid(cfg.meta_pixel_id)||valid(cfg.tiktok_pixel_id)||validGTM(cfg.gtm_container_id);}
  function purchase(order){
    if(!configure(cfg)||!order||!valid(order.event_id))return false;
    const value=Number(order.value);if(!Number.isFinite(value)||value<0)return false;
    const event={event:'craft_purchase',event_id:order.event_id,ecommerce:{currency:order.currency, value, items:order.items||[]}};
    (root.dataLayer=root.dataLayer||[]).push(event);
    if(valid(cfg.meta_pixel_id)){loadMeta();root.fbq('track','Purchase',{currency:order.currency,value,contents:order.items||[]},{eventID:order.event_id});}
    if(valid(cfg.tiktok_pixel_id)){loadTikTok();root.ttq.track('CompletePayment',{currency:order.currency,value,contents:order.items||[],event_id:order.event_id});}
    return true;
  }
  root.CraftWebTracking={configure,purchase};
  if(typeof module!=='undefined')module.exports=root.CraftWebTracking;
})(typeof window!=='undefined'?window:globalThis);
