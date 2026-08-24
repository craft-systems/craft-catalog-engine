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

// --- ícono/label de categoría desde el emoji líder del nombre (misma lógica que catIcon/catLabel) ---
const leadingEmoji = str => {
  const m = (str || '').match(/^\s*(\p{Extended_Pictographic}(?:[️‍\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic})*)/u);
  return m ? m[1].trim() : '';
};
const catLabel = name => { const e = leadingEmoji(name); return e ? (name || '').replace(e, '').trim() : (name || ''); };

assert.strictEqual(leadingEmoji('🧀 Bites'), '🧀');
assert.strictEqual(catLabel('🧀 Bites'), 'Bites');
assert.strictEqual(leadingEmoji('🍽️ Almuerzos'), '🍽️');   // emoji con variation selector
assert.strictEqual(catLabel('🍽️ Almuerzos'), 'Almuerzos');
assert.strictEqual(leadingEmoji('Sin Emoji'), '');          // sin emoji → keyword match / name tal cual
assert.strictEqual(catLabel('Sin Emoji'), 'Sin Emoji');

// --- total de un grupo de distribución = número en el nombre del grupo (misma lógica que distGroup) ---
const distTotal = groupName => { const m = String(groupName || '').match(/\d+/); return m ? +m[0] : 1; };
assert.strictEqual(distTotal('Elige tus 3 sabores'), 3);
assert.strictEqual(distTotal('Elige 2 sabores'), 2);
assert.strictEqual(distTotal('Sabores'), 1);

console.log('ok — promo day filter + category emoji + dist total');
