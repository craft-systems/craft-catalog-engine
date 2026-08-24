// node promo.test.cjs — chequea el filtro de oferta por día (misma lógica que promoActiveToday en catalog.js)
const assert = require('assert');

// réplica pura de promoActiveToday(p) para test sin DOM
const activeOn = (sku, today) => {
  const raw = (sku || '').trim();
  if (!raw) return true;
  return raw.split(',').map(s => parseInt(s, 10)).includes(today);
};

// sku vacío → siempre visible (retrocompat otros catálogos)
assert.strictEqual(activeOn('', 3), true);
assert.strictEqual(activeOn(undefined, 0), true);
// día único: visible solo ese día
assert.strictEqual(activeOn('3', 3), true);   // miércoles
assert.strictEqual(activeOn('3', 4), false);  // jueves → oculta
// varios días (ej. jueves con 3 promos comparten día, o una promo activa 2 días)
assert.strictEqual(activeOn('5,6', 6), true);
assert.strictEqual(activeOn('5,6', 0), false);
// domingo = 0
assert.strictEqual(activeOn('0', 0), true);

console.log('ok — promo day filter');
