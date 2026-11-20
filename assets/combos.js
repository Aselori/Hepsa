'use strict';

// Vista previa del ahorro. Las dos rutas de registro lo calculan en PostgreSQL.
async function leerCombosDisponibles(sb) {
    if (typeof sb?.rpc !== 'function') return [];
    const { data } = await sb.rpc('available_bundles');
    return Array.isArray(data) ? data.filter(combo => Array.isArray(combo.items) && combo.items.length >= 2) : [];
}

function estimarCombo(combos, lineas) {
    const porProducto = new Map();
    for (const { id, qty, price } of lineas) {
        const anterior = porProducto.get(id);
        porProducto.set(id, { qty: (anterior?.qty || 0) + qty, centavos: Math.round(price * 100) });
    }
    let mejor = null;
    for (const combo of combos) {
        let juegos = Infinity;
        let base = 0;
        for (const { product_id, quantity: cantidad } of combo.items) {
            const linea = porProducto.get(product_id);
            juegos = Math.min(juegos, Math.floor((linea?.qty || 0) / cantidad));
            base += (linea?.centavos || 0) * cantidad;
        }
        const tasa = Math.round(combo.discount_percent * 100);
        const ahorro = Math.round(base * juegos * tasa / 10000) / 100;
        if (ahorro > 0 && (!mejor || ahorro > mejor.discount ||
                (ahorro === mejor.discount && combo.id < mejor.id))) {
            mejor = { id: combo.id, name: combo.name, sets: juegos, discount: ahorro };
        }
    }
    return mejor;
}

function monedaPaquete(importe, decimales = 0) {
    return Number(importe).toLocaleString('es-MX', {
        style: 'currency', currency: 'MXN', minimumFractionDigits: decimales, maximumFractionDigits: 2,
    });
}

function pintarDescuentoPaquete(elemento, combo) {
    elemento.hidden = !combo;
    if (!combo) {
        elemento.replaceChildren();
        return;
    }
    const etiqueta = Object.assign(document.createElement('strong'), { textContent: 'Descuento por paquete' });
    const importe = Object.assign(document.createElement('strong'), { textContent: `−${monedaPaquete(combo.discount, 2)}` });
    const cantidad = combo.sets > 1 ? ` × ${combo.sets}` : '';
    const nombre = Object.assign(document.createElement('small'), { textContent: combo.name + cantidad });
    elemento.replaceChildren(etiqueta, importe, nombre);
}
