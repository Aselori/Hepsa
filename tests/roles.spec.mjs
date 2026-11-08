// Permisos por rol (20261107000002_permisos_por_rol.sql), contra el stack local.
//
// Cada "no puede" del modelo de roles se prueba en la base, no en el panel:
// esconder un botón no detiene a quien edita la página.
//
//   vendedor  no cambia precio ni nombre, no da de alta productos, no inserta
//             ventas a mano ni cambia importes; vende por registrar_venta().
//   taller    no lee orders; ve pedidos_de_taller() sin precios y sólo mueve
//             entre "en producción" e "instalado".
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
const creados = { productos: [], pedidos: [] };

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
  const venta = await vendedor.c.rpc('registrar_venta', {
    p_cliente: { nombre: 'Prueba', apellidos: 'Roles' },
    p_conceptos: [{ producto_id: producto.id, cantidad: 2, precio: 1 }, { concepto: 'Instalación', precio: 500 }],
    p_pago: 'anticipo', p_notas: null,
  });
  check('el vendedor registra una venta por registrar_venta()', Number.isSafeInteger(venta.data), venta.error?.message ?? '');
  if (Number.isSafeInteger(venta.data)) creados.pedidos.push(venta.data);
  const guardada = (await admin.c.from('orders').select('subtotal, tax, total, seller_id, project_status').eq('id', venta.data).single()).data;
  check('la venta usa el precio del catálogo, el IVA de la base y registra al vendedor',
    Number(guardada?.subtotal) === 2500 && Number(guardada?.total) === 2900 && guardada?.seller_id === vendedor.id,
    JSON.stringify(guardada));

  const importe = await vendedor.c.from('orders').update({ total: 1 }).eq('id', venta.data).select('total');
  check('el vendedor no cambia los importes de una venta', !!importe.error && /administrador/.test(importe.error.message), importe.error?.message ?? 'se cambió');

  const pago = await vendedor.c.from('orders').update({ project_status: 'en_produccion' }).eq('id', venta.data).select('project_status').single();
  check('el vendedor sí avanza el proyecto a producción', pago.data?.project_status === 'en_produccion', pago.error?.message ?? '');

  const ventaCliente = await cliente.c.rpc('registrar_venta', { p_cliente: { nombre: 'X' }, p_conceptos: [{ concepto: 'X', precio: 1 }], p_pago: 'completo' });
  check('un cliente no puede registrar ventas', !!ventaCliente.error);

  // ─── Taller ───────────────────────────────────────────────────────────────
  const ordenesTaller = await taller.c.from('orders').select('id, total');
  check('el taller no lee la tabla de ventas (importes)', (ordenesTaller.data?.length ?? 0) === 0, `filas=${ordenesTaller.data?.length}`);

  const produccion = await taller.c.rpc('pedidos_de_taller');
  const fila = produccion.data?.find((p) => p.id === venta.data);
  check('el taller ve el pedido en producción, con conceptos y sin precios',
    !!fila && fila.conceptos?.length === 2 && !JSON.stringify(fila).includes('2500') && !('total' in fila) && !JSON.stringify(fila.conceptos).includes('precio'),
    JSON.stringify(fila));

  const instalar = await taller.c.rpc('avanzar_proyecto', { p_pedido: venta.data, p_estado: 'instalado' });
  const instalado = (await admin.c.from('orders').select('project_status').eq('id', venta.data).single()).data;
  check('el taller marca el pedido como instalado', !instalar.error && instalado?.project_status === 'instalado', instalar.error?.message ?? '');

  const regresar = await taller.c.rpc('avanzar_proyecto', { p_pedido: venta.data, p_estado: 'cotizando' });
  check('el taller no regresa un pedido a cotización', !!regresar.error, regresar.error?.message ?? 'se regresó');

  const produccionCliente = await cliente.c.rpc('pedidos_de_taller');
  check('un cliente no ve los pedidos de producción', !!produccionCliente.error);

  // ─── Equipo y configuración ───────────────────────────────────────────────
  const quitarse = await admin.c.from('profiles').update({ role: 'vendedor' }).eq('id', admin.id).select('role');
  check('el admin no puede quitarse a sí mismo el rol', !!quitarse.error && /a ti mismo/.test(quitarse.error.message), quitarse.error?.message ?? 'se lo quitó');

  const ascenso = await vendedor.c.from('profiles').update({ role: 'admin' }).eq('id', taller.id).select('role');
  check('el vendedor no cambia roles', !!ascenso.error || (ascenso.data?.length ?? 0) === 0, ascenso.error?.message ?? 'cambió');

  const ivaVendedor = await vendedor.c.from('parametros_cotizacion').update({ valor: 0.5 }).eq('clave', 'iva').select('valor');
  check('el vendedor no cambia el IVA', (ivaVendedor.data?.length ?? 0) === 0, JSON.stringify(ivaVendedor.data ?? ivaVendedor.error?.message));

  const mensaje = (await admin.c.from('parametros_cotizacion').select('texto').eq('clave', 'mensaje_ticket').single()).data;
  check('el mensaje del ticket vive en la base', !!mensaje?.texto, JSON.stringify(mensaje));
} finally {
  for (const id of creados.pedidos) {
    await admin.c.from('order_items').delete().eq('order_id', id);
    await admin.c.from('orders').delete().eq('id', id);
  }
  for (const id of creados.productos) await admin.c.from('products').delete().eq('id', id);
  for (const s of [admin, vendedor, taller, cliente]) await s.c.auth.signOut();
}

const fallidas = checks.filter((ok) => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de permisos por rol.`);
if (fallidas) process.exitCode = 1;
