// Permisos por rol (20261107000002_permisos_por_rol.sql), contra el stack local.
//
// Cada "no puede" del modelo de roles se prueba en la base, no en el panel:
// esconder un botón no detiene a quien edita la página.
//
//   vendedor  no cambia precio ni nombre, no da de alta productos, no inserta
//             ventas a mano ni cambia importes; vende por register_sale().
//   taller    no lee orders; ve workshop_orders() sin precios y sólo mueve
//             entre "en producción" e "instalado". Anota esos pedidos por
//             add_note(), nunca escribiendo en notes.
//   admin     no puede quitarse a sí mismo el rol.
import { createClient } from '@supabase/supabase-js';
import { codigoTOTPFresco } from './totp.mjs';

const URL_SB = process.env.HEPSA_TEST_SUPABASE_URL;
const LLAVE = process.env.HEPSA_TEST_SUPABASE_KEY;
if (!URL_SB?.startsWith('http://127.0.0.1:') || !LLAVE || !process.env.TALLER_EMAIL) {
  console.error('Esta suite sólo corre contra el stack local: npm run test:local');
  process.exit(2);
}

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

async function entrar(prefijo, conFactor = true) {
  const c = createClient(URL_SB, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: process.env[`${prefijo}_EMAIL`], password: process.env[`${prefijo}_PASS`] });
  if (error) throw new Error(`${prefijo}: ${error.message}`);
  if (conFactor) {
    const factores = await c.auth.mfa.listFactors();
    const factor = factores.data?.totp?.find((f) => f.status === 'verified');
    const v = await c.auth.mfa.challengeAndVerify({ factorId: factor.id, code: await codigoTOTPFresco(process.env[`${prefijo}_TOTP`]) });
    if (v.error) throw new Error(`${prefijo} 2FA: ${v.error.message}`);
  }
  return { c, id: data.user.id };
}

const admin = await entrar('ADMIN');
const vendedor = await entrar('VENDEDOR');
const taller = await entrar('TALLER');
const cliente = await entrar('CLIENTE', false);
const creados = { productos: [], pedidos: [], solicitudes: [] };

try {
  // ─── Catálogo ─────────────────────────────────────────────────────────────
  const alta = await admin.c.from('products').insert({ name: `Prueba roles ${Date.now()}`, price: 1000, stock: 5, is_active: true }).select('id, price, stock').single();
  check('el admin da de alta un producto', !alta.error, alta.error?.message ?? '');
  const producto = alta.data;
  if (producto) creados.productos.push(producto.id);

  const altaVendedor = await vendedor.c.from('products').insert({ name: 'INTRUSO VENDEDOR', price: 1 }).select('id');
  check('el vendedor no da de alta productos', !!altaVendedor.error, altaVendedor.error?.message ?? 'se insertó');
  if (altaVendedor.data?.[0]) creados.productos.push(altaVendedor.data[0].id);

  const precio = await vendedor.c.from('products').update({ price: 1 }).eq('id', producto.id).select('price');
  check('el vendedor no cambia el precio', !!precio.error && /administrador/.test(precio.error.message), precio.error?.message ?? 'se cambió');

  const existencias = await vendedor.c.from('products').update({ stock: 7 }).eq('id', producto.id).select('stock').single();
  check('el vendedor sí ajusta existencias', existencias.data?.stock === 7, existencias.error?.message ?? JSON.stringify(existencias.data));

  // ─── Ventas ───────────────────────────────────────────────────────────────
  const aMano = await vendedor.c.from('orders').insert({ subtotal: 1, tax: 0, total: 1 }).select('id');
  check('el vendedor no inserta ventas a mano (importes del navegador)', !!aMano.error, aMano.error?.message ?? 'se insertó');
  if (aMano.data?.[0]) creados.pedidos.push(aMano.data[0].id);

  // El precio que manda el navegador para un producto del catálogo se ignora.
  const venta = await vendedor.c.rpc('register_sale', {
    p_client: { name: 'Prueba', last_name: 'Roles' },
    p_items: [{ product_id: producto.id, quantity: 2, price: 1 }, { label: 'Instalación', price: 500 }],
    p_payment: 'deposit', p_notes: null,
  });
  check('el vendedor registra una venta por register_sale()', Number.isSafeInteger(venta.data), venta.error?.message ?? '');
  if (Number.isSafeInteger(venta.data)) creados.pedidos.push(venta.data);
  const guardada = (await admin.c.from('orders').select('subtotal, tax, total, seller_id, project_status').eq('id', venta.data).single()).data;
  check('la venta usa el precio del catálogo, el IVA de la base y registra al vendedor',
    Number(guardada?.subtotal) === 2500 && Number(guardada?.total) === 2900 && guardada?.seller_id === vendedor.id,
    JSON.stringify(guardada));

  const importe = await vendedor.c.from('orders').update({ total: 1 }).eq('id', venta.data).select('total');
  check('el vendedor no cambia los importes de una venta', !!importe.error && /administrador/.test(importe.error.message), importe.error?.message ?? 'se cambió');

  const pago = await vendedor.c.from('orders').update({ project_status: 'in_production' }).eq('id', venta.data).select('project_status').single();
  check('el vendedor sí avanza el proyecto a producción', pago.data?.project_status === 'in_production', pago.error?.message ?? '');

  const ventaCliente = await cliente.c.rpc('register_sale', { p_client: { name: 'X' }, p_items: [{ label: 'X', price: 1 }], p_payment: 'paid' });
  check('un cliente no puede registrar ventas', !!ventaCliente.error);

  // ─── Taller ───────────────────────────────────────────────────────────────
  const ordenesTaller = await taller.c.from('orders').select('id, total');
  check('el taller no lee la tabla de ventas (importes)', (ordenesTaller.data?.length ?? 0) === 0, `filas=${ordenesTaller.data?.length}`);

  const produccion = await taller.c.rpc('workshop_orders');
  const fila = produccion.data?.find((p) => p.id === venta.data);
  check('el taller ve el pedido en producción, con conceptos y sin precios',
    !!fila && fila.items?.length === 2 && !JSON.stringify(fila).includes('2500') && !('total' in fila) && !JSON.stringify(fila.items).includes('precio'),
    JSON.stringify(fila));

  // ─── Notas de los pedidos ────────────────────────────────────────────────
  const nota = await taller.c.rpc('add_note', { p_order_id: venta.data, p_body: '  Falta lámina de 14  ' });
  check('el taller anota un pedido en producción, con su nombre y rol',
    nota.data?.body === 'Falta lámina de 14' && nota.data?.author_role === 'workshop' && !!nota.data?.author_name, nota.error?.message ?? JSON.stringify(nota.data));
  const directa = await taller.c.from('notes').insert({ order_id: venta.data, author_name: 'Otro', author_role: 'admin', body: 'x' }).select('id');
  check('el taller no escribe notas a mano (autor falsificado)', !!directa.error, directa.error?.message ?? 'se insertó');
  const borrar = await taller.c.from('notes').delete().eq('order_id', venta.data).select('id');
  check('el taller no borra notas', !!borrar.error || (borrar.data?.length ?? 0) === 0, borrar.error?.message ?? 'se borró');
  const vacia = await taller.c.rpc('add_note', { p_order_id: venta.data, p_body: '   ' });
  check('una nota vacía se rechaza', !!vacia.error, vacia.error?.message ?? 'se guardó');
  const leidas = await vendedor.c.from('notes').select('body, author_role').eq('order_id', venta.data);
  check('el vendedor lee las notas del taller', leidas.data?.length === 1 && leidas.data[0].author_role === 'workshop', JSON.stringify(leidas.data ?? leidas.error?.message));
  const notasCliente = await cliente.c.from('notes').select('id');
  check('un cliente no lee notas internas', (notasCliente.data?.length ?? 0) === 0, `filas=${notasCliente.data?.length}`);
  const notaCliente = await cliente.c.rpc('add_note', { p_order_id: venta.data, p_body: 'x' });
  check('un cliente no agrega notas', !!notaCliente.error);

  const bitacora = (await taller.c.rpc('workshop_orders')).data?.find((p) => p.id === venta.data)?.internal_notes;
  check('el taller recibe la bitácora del pedido en workshop_orders', bitacora?.length === 1 && bitacora[0].body === 'Falta lámina de 14', JSON.stringify(bitacora));
  const tablaTaller = await taller.c.from('notes').select('id');
  check('el taller no lee la tabla de notas directamente', (tablaTaller.data?.length ?? 0) === 0, `filas=${tablaTaller.data?.length}`);

  const cotizando = await vendedor.c.rpc('register_sale', { p_client: { name: 'Prueba', last_name: 'Notas' },
    p_items: [{ label: 'Instalación', price: 500 }], p_payment: 'deposit', p_notes: null });
  if (Number.isSafeInteger(cotizando.data)) creados.pedidos.push(cotizando.data);
  const notaFuera = await taller.c.rpc('add_note', { p_order_id: cotizando.data, p_body: 'x' });
  check('el taller no anota una venta que no ve (en cotización)', !!notaFuera.error, notaFuera.error?.message ?? 'se guardó');

  const solicitudId = crypto.randomUUID();
  const solicitud = await admin.c.from('custom_requests').insert({ id: solicitudId, first_name: 'Prueba', last_name: 'Notas',
    length_mm: 1000, height_mm: 1000, material: 'steel', finish: 'bluing' });
  if (!solicitud.error) creados.solicitudes.push(solicitudId);
  const notaSolicitud = await vendedor.c.rpc('add_note', { p_request_id: solicitudId, p_body: 'Pidió cotizar también en aluminio' });
  check('el vendedor anota una solicitud', !notaSolicitud.error && notaSolicitud.data?.request_id === solicitudId, notaSolicitud.error?.message ?? '');
  const notaSolicitudTaller = await taller.c.rpc('add_note', { p_request_id: solicitudId, p_body: 'x' });
  check('el taller no anota solicitudes', !!notaSolicitudTaller.error, notaSolicitudTaller.error?.message ?? 'se guardó');
  const ambas = await vendedor.c.rpc('add_note', { p_order_id: venta.data, p_request_id: solicitudId, p_body: 'x' });
  check('una nota va en una venta o en una solicitud, no en ambas', !!ambas.error, ambas.error?.message ?? 'se guardó');
  const estadoSolicitud = (await admin.c.from('custom_requests').select('status, quote_expires_at').eq('id', solicitudId).single()).data;
  check('una solicitud nueva nace pendiente y con vigencia', estadoSolicitud?.status === 'pending' && !!estadoSolicitud?.quote_expires_at, JSON.stringify(estadoSolicitud));
  const estadoLibre = await vendedor.c.from('custom_requests').update({ status: 'Lo que sea' }).eq('id', solicitudId).select('id');
  check('el estado de una solicitud sólo acepta los valores definidos', !!estadoLibre.error, estadoLibre.error?.message ?? 'se aceptó');
  const totalFalso = await admin.c.from('orders').update({ total: 1 }).eq('id', venta.data).select('id');
  check('el total de una venta no puede contradecir subtotal + IVA', !!totalFalso.error, totalFalso.error?.message ?? 'se aceptó');

  const instalar = await taller.c.rpc('set_project_status', { p_order_id: venta.data, p_status: 'installed' });
  const instalado = (await admin.c.from('orders').select('project_status').eq('id', venta.data).single()).data;
  check('el taller marca el pedido como instalado', !instalar.error && instalado?.project_status === 'installed', instalar.error?.message ?? '');

  const regresar = await taller.c.rpc('set_project_status', { p_order_id: venta.data, p_status: 'quoting' });
  check('el taller no regresa un pedido a cotización', !!regresar.error, regresar.error?.message ?? 'se regresó');

  await vendedor.c.from('orders').update({ project_status: 'quoting' }).eq('id', venta.data);
  const enCotizacion = await taller.c.rpc('add_note', { p_order_id: venta.data, p_body: 'x' });
  check('el taller no anota un pedido que no está en producción ni instalado', !!enCotizacion.error, enCotizacion.error?.message ?? 'se guardó');

  const produccionCliente = await cliente.c.rpc('workshop_orders');
  check('un cliente no ve los pedidos de producción', !!produccionCliente.error);

  // ─── Equipo y configuración ───────────────────────────────────────────────
  const quitarse = await admin.c.from('profiles').update({ role: 'seller' }).eq('id', admin.id).select('role');
  check('el admin no puede quitarse a sí mismo el rol', !!quitarse.error && /a ti mismo/.test(quitarse.error.message), quitarse.error?.message ?? 'se lo quitó');

  const ascenso = await vendedor.c.from('profiles').update({ role: 'admin' }).eq('id', taller.id).select('role');
  check('el vendedor no cambia roles', !!ascenso.error || (ascenso.data?.length ?? 0) === 0, ascenso.error?.message ?? 'cambió');

  const ivaVendedor = await vendedor.c.from('quote_settings').update({ value: 0.5 }).eq('key', 'tax_rate').select('value');
  check('el vendedor no cambia el IVA', (ivaVendedor.data?.length ?? 0) === 0, JSON.stringify(ivaVendedor.data ?? ivaVendedor.error?.message));

  const mensaje = (await admin.c.from('quote_settings').select('text_value').eq('key', 'ticket_message').single()).data;
  check('el mensaje del ticket vive en la base', !!mensaje?.text_value, JSON.stringify(mensaje));
} finally {
  for (const id of creados.pedidos) {
    await admin.c.from('order_items').delete().eq('order_id', id);
    await admin.c.from('orders').delete().eq('id', id);
  }
  for (const id of creados.productos) await admin.c.from('products').delete().eq('id', id);
  for (const id of creados.solicitudes) await admin.c.from('custom_requests').delete().eq('id', id);
  for (const s of [admin, vendedor, taller, cliente]) await s.c.auth.signOut();
}

const fallidas = checks.filter((ok) => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de permisos por rol.`);
if (fallidas) process.exitCode = 1;
