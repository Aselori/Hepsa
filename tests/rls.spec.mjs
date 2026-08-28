import { chromium } from 'playwright';

const BASE = 'http://localhost:8000';

// Las credenciales NO viven en el repo. Se pasan por entorno; lo comodo es
// dejarlas en tests/.env.local (ignorado por git) y correr:
//   node --env-file=tests/.env.local tests/rls.spec.mjs
const env = process.env;
function cuenta(rol, prefijo) {
  const email = env[`${prefijo}_EMAIL`];
  const pass  = env[`${prefijo}_PASS`];
  if (!email || !pass) {
    console.error(
      `Falta ${prefijo}_EMAIL o ${prefijo}_PASS para el rol "${rol}".\n` +
      `Crea tests/.env.local (ver tests/README.md) y corre:\n` +
      `  node --env-file=tests/.env.local tests/rls.spec.mjs`);
    process.exit(2);
  }
  return { email, pass };
}
const CUENTAS = {
  admin:    cuenta('admin', 'ADMIN'),
  vendedor: cuenta('vendedor', 'VENDEDOR'),
  cliente:  cuenta('cliente', 'CLIENTE'),
};

const resultados = [];
function check(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok, detalle });
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

// Inicia sesión usando el cliente de Supabase que la propia página ya cargó.
async function entrar(page, { email, pass }) {
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => window.supabaseClient !== undefined);
  const err = await page.evaluate(async ([e, p]) => {
    const { error } = await window.supabaseClient.auth.signInWithPassword({ email: e, password: p });
    return error?.message ?? null;
  }, [email, pass]);
  if (err) throw new Error(`login ${email}: ${err}`);
}

// Abre admin.html y reporta si fue expulsado (alert + redirect a index.html).
async function abrirAdmin(page) {
  let alerta = null;
  const onDialog = async (d) => { alerta = d.message(); await d.dismiss(); };
  page.on('dialog', onDialog);
  await page.goto(`${BASE}/admin.html`);
  await page.waitForTimeout(2500);
  page.off('dialog', onDialog);
  return { alerta, url: page.url() };
}

const browser = await chromium.launch();

try {
  // ── 1. cliente NO debe entrar al panel ───────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await entrar(page, CUENTAS.cliente);
    const { alerta, url } = await abrirAdmin(page);
    check('cliente es expulsado de admin.html',
      alerta?.includes('ACCESO DENEGADO') && url.includes('index.html'),
      `alerta=${JSON.stringify(alerta)} url=${url.replace(BASE, '')}`);
    await ctx.close();
  }

  // ── 2. anónimo tampoco ───────────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const { alerta, url } = await abrirAdmin(page);
    check('anonimo no entra a admin.html',
      !url.endsWith('/admin.html') || alerta !== null,
      `alerta=${JSON.stringify(alerta)} url=${url.replace(BASE, '')}`);
    await ctx.close();
  }

  // ── 3. vendedor y admin sí entran y ven las solicitudes ──────────────────
  for (const rol of ['vendedor', 'admin']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await entrar(page, CUENTAS[rol]);
    const { alerta, url } = await abrirAdmin(page);
    check(`${rol} entra a admin.html`,
      alerta === null && url.endsWith('/admin.html'),
      `alerta=${JSON.stringify(alerta)}`);

    if (url.endsWith('/admin.html')) {
      const mostrado = await page.locator('#user-role-display').innerText().catch(() => '');
      check(`${rol} ve su rol en pantalla`, mostrado.toLowerCase().includes(rol), `"${mostrado}"`);

      // El panel abre en "Punto de Venta"; las solicitudes estan en otra vista.
      await page.click('#nav-projects');
      await page.waitForTimeout(1500);
      const cuerpo = await page.locator('#view-projects').innerText();
      const nombres = ['Ana', 'Luis', 'Marta'].filter((n) => cuerpo.includes(n));
      check(`${rol} ve las 3 solicitudes`, nombres.length === 3, `encontradas: ${nombres.join(', ') || 'ninguna'}`);
    }
    await page.screenshot({ path: `tests/screenshots/panel-${rol}.png`, fullPage: true });
    await ctx.close();
  }

  // ── 4. el vendedor NO debe poder borrar (solo admin) ─────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await entrar(page, CUENTAS.vendedor);
    const r = await page.evaluate(async () => {
      const { data: p } = await window.supabaseClient.from('products').select('id').limit(1).single();
      const { error, count } = await window.supabaseClient
        .from('products').delete({ count: 'exact' }).eq('id', p.id);
      return { error: error?.message ?? null, count };
    });
    check('vendedor no puede borrar productos', r.count === 0 || r.error !== null,
      `borradas=${r.count} error=${JSON.stringify(r.error)}`);
    await ctx.close();
  }

  // ── 4b. y la interfaz debe DECIRSELO, no fingir que borro ────────────────
  // RLS no devuelve error al vendedor: devuelve 0 filas. Si admin.html solo
  // mirara `error`, el toast diria "eliminado" sin haber borrado nada.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await entrar(page, CUENTAS.vendedor);
    page.on('dialog', (d) => d.accept()); // el confirm() de eliminarProducto
    await page.goto(`${BASE}/admin.html`);
    await page.waitForTimeout(2000);

    const antes = await page.evaluate(async () => {
      const { count } = await window.supabaseClient
        .from('products').select('id', { count: 'exact', head: true });
      return count;
    });
    const id = await page.evaluate(async () => {
      const { data } = await window.supabaseClient.from('products').select('id').limit(1).single();
      return data.id;
    });

    await page.evaluate((pid) => window.eliminarProducto(pid, 'Producto de prueba'), id);
    await page.waitForTimeout(1500);

    const toast = await page.locator('#toast-container').innerText().catch(() => '');
    const despues = await page.evaluate(async () => {
      const { count } = await window.supabaseClient
        .from('products').select('id', { count: 'exact', head: true });
      return count;
    });

    check('vendedor: la interfaz avisa que NO se elimino',
      !/eliminado/i.test(toast) && /administrador/i.test(toast), `toast="${toast.trim()}"`);
    check('vendedor: el producto sigue ahi', antes === despues, `${antes} -> ${despues}`);
    await ctx.close();
  }

  // ── 5. el cliente no debe ver el directorio ni las solicitudes ───────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await entrar(page, CUENTAS.cliente);
    const r = await page.evaluate(async () => {
      const perfiles = await window.supabaseClient.from('profiles').select('email');
      const solic    = await window.supabaseClient.from('custom_requests').select('email');
      const ordenes  = await window.supabaseClient.from('orders').select('id');
      return { perfiles: perfiles.data?.length, solic: solic.data?.length, ordenes: ordenes.data?.length };
    });
    check('cliente solo se ve a si mismo en profiles', r.perfiles === 1, `filas=${r.perfiles}`);
    check('cliente no ve solicitudes', r.solic === 0, `filas=${r.solic}`);
    check('cliente no ve ordenes ajenas', r.ordenes === 0, `filas=${r.ordenes}`);
    await ctx.close();
  }
  // ── 6. Cotizador estructurado ────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const alertas = [];
    page.on('dialog', async (d) => { alertas.push(d.message()); await d.accept(); });
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.supabaseClient !== undefined);
    await page.click('#btn-quote'); // el formulario vive en una vista oculta
    await page.waitForSelector('#quote-largo', { state: 'visible' });

    const llenar = async (largo, alto, material, acabado) => {
      await page.fill('#quote-largo', String(largo));
      await page.fill('#quote-alto', String(alto));
      await page.selectOption('#quote-material', material);
      await page.selectOption('#quote-acabado', acabado);
    };

    // Un anonimo puede cotizar sin registrarse.
    await llenar(2000, 1000, 'acero', 'cromado');
    await page.click('text=Calcular Cotización');
    await page.waitForTimeout(1200);
    const monto = await page.locator('#quote-estimate-amount').innerText();
    check('anonimo obtiene estimado', /7,000/.test(monto), `monto="${monto}"`);

    const aviso = await page.locator('#quote-estimate').innerText();
    check('el estimado lleva aviso de no ser en firme',
      /no constituye una cotizaci[oó]n en firme/i.test(aviso));

    // Medidas absurdas: se atajan antes de llegar a la base.
    alertas.length = 0;
    await llenar(50000, 1000, 'acero', 'cromado');
    await page.click('text=Calcular Cotización');
    await page.waitForTimeout(800);
    check('rechaza medidas fuera de rango',
      alertas.some((a) => /20,000 mm/.test(a)), `alertas=${JSON.stringify(alertas)}`);

    // El tarifario es informacion comercial: no se expone al publico.
    const tarifas = await page.evaluate(async () => {
      const m = await window.supabaseClient.from('tarifas_material').select('*');
      const a = await window.supabaseClient.from('tarifas_acabado').select('*');
      return { m: m.data?.length, a: a.data?.length };
    });
    check('anonimo no ve el tarifario', tarifas.m === 0 && tarifas.a === 0,
      `material=${tarifas.m} acabado=${tarifas.a}`);

    // Lo que de verdad importa: el precio lo pone el servidor.
    const manipulado = await page.evaluate(async () => {
      const correo = `precio-falso-${Date.now()}@test.local`;
      await window.supabaseClient.from('custom_requests').insert([{
        first_name: 'Precio', last_name_p: 'Falso', email: correo, phone: '0000000000',
        largo_mm: 2000, alto_mm: 1000, material: 'acero', acabado: 'cromado',
        precio_estimado: 1,
      }]);
      const { data } = await window.supabaseClient
        .rpc('calcular_precio', { p_largo_mm: 2000, p_alto_mm: 1000, p_material: 'acero', p_acabado: 'cromado' });
      return { correo, esperado: data };
    });
    const guardado = await page.evaluate(async () => null); // el anonimo no puede releer: se verifica abajo
    check('el precio manipulado no se acepta tal cual', manipulado.esperado !== 1,
      `calculado=${manipulado.esperado}`);
    globalThis.__correoManipulado = manipulado.correo;
    void guardado;
    await ctx.close();
  }

  // ── 7. Carrito (Mejora 1) ────────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('[data-add-id]');

    const leerCart = () => page.evaluate(() => cart.map(({ id, qty }) => ({ id, qty })));

    // Dos productos distintos comparten el nombre "Puerta de madera de abeto"
    // (ids 7 y 8, a $14,000 y $20,000). Con el carrito viejo eran la misma
    // linea; ahora deben quedar separados.
    const ids = await page.evaluate(() =>
      Object.values(catalogo).filter((p) => p.name === 'Puerta de madera de abeto').map((p) => p.id).sort());
    check('el catalogo tiene dos productos homonimos', ids.length === 2, `ids=${ids}`);

    await page.click(`[data-add-id="${ids[0]}"]`);
    await page.click(`[data-add-id="${ids[1]}"]`);
    const separados = await leerCart();
    check('productos con el mismo nombre no se mezclan',
      separados.length === 2, JSON.stringify(separados));

    // Agregar dos veces el mismo producto agrupa en cantidad.
    await page.click(`[data-add-id="${ids[0]}"]`);
    const agrupado = await leerCart();
    check('el mismo producto agrupa por cantidad',
      agrupado.length === 2 && agrupado.find((l) => l.id === ids[0]).qty === 2,
      JSON.stringify(agrupado));

    // Acumular y decrementar con los botones + y -, que es lo que el equipo
    // reporto que no funcionaba: en el original no existian.
    await page.click('#cart-btn');
    await page.click(`[data-qty-id="${ids[0]}"][data-delta="1"]`);
    await page.click(`[data-qty-id="${ids[0]}"][data-delta="1"]`);
    let conMas = await leerCart();
    check('el boton + acumula', conMas.find((l) => l.id === ids[0]).qty === 4,
      `qty=${conMas.find((l) => l.id === ids[0]).qty}`);

    await page.click(`[data-qty-id="${ids[0]}"][data-delta="-1"]`);
    conMas = await leerCart();
    check('el boton - decrementa', conMas.find((l) => l.id === ids[0]).qty === 3,
      `qty=${conMas.find((l) => l.id === ids[0]).qty}`);

    // Volver a 2 para que el resto de las comprobaciones siga cuadrando.
    await page.click(`[data-qty-id="${ids[0]}"][data-delta="-1"]`);
    const agrupado2 = await leerCart();

    // El total sale del precio del catalogo, no de un valor pegado al HTML.
    const esperado = await page.evaluate((ls) =>
      ls.reduce((t, l) => t + catalogo[l.id].price * l.qty, 0), agrupado2);
    const mostrado = await page.locator('#cart-total-price').innerText();
    check('el total del carrito cuadra',
      Number(mostrado.replace(/,/g, '')) === esperado, `mostrado=${mostrado} esperado=${esperado}`);

    // Se puede quitar, cosa que antes era imposible sin recargar.
    await page.click(`[data-remove-id="${ids[1]}"]`);
    check('se puede quitar una linea', (await leerCart()).length === 1);

    // Bajar de 1 elimina la linea.
    await page.click(`[data-qty-id="${ids[0]}"][data-delta="-1"]`);
    await page.click(`[data-qty-id="${ids[0]}"][data-delta="-1"]`);
    check('bajar la cantidad a cero quita la linea', (await leerCart()).length === 0);

    // Sobrevive a recargar la pagina.
    await page.click(`[data-add-id="${ids[0]}"]`);
    await page.reload();
    await page.waitForSelector('[data-add-id]');
    await page.waitForFunction(() => cart.length > 0, null, { timeout: 5000 }).catch(() => {});
    const trasRecarga = await leerCart();
    check('el carrito sobrevive a recargar', trasRecarga.length === 1 && trasRecarga[0].qty === 1,
      JSON.stringify(trasRecarga));

    await page.evaluate(() => { localStorage.removeItem('hepsa_cart'); });
    await ctx.close();
  }

  // ── 8. Tope por existencias ──────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Si algo abre un alert() del navegador, la prueba lo delata.
    const dialogos = [];
    page.on('dialog', async (d) => { dialogos.push(d.message()); await d.accept(); });
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('[data-add-id]');

    // El producto 6 tiene stock 1: agregarlo dos veces debe toparse.
    const stock6 = await page.evaluate(() => catalogo[6]?.stock);
    check('el catalogo trae el stock', stock6 === 1, `stock=${stock6}`);

    await page.click('[data-add-id="6"]');
    // Al llegar al tope el boton se apaga y cambia de texto.
    const textoBoton = await page.locator('[data-add-id="6"]').innerText();
    const apagado = await page.locator('[data-add-id="6"]').evaluate((b) => b.classList.contains('agotado'));
    check('el boton se apaga al llegar al tope',
      apagado && /Sin m[aá]s existencias/i.test(textoBoton), `texto="${textoBoton}" apagado=${apagado}`);

    await page.click('[data-add-id="6"]');
    const qty6 = await page.evaluate(() => cart.find((l) => l.id === 6)?.qty);
    check('no se puede pasar del stock', qty6 === 1, `qty=${qty6}`);

    const aviso = await page.locator('#toast-container .toast').innerText();
    check('avisa con un toast, no con alert()',
      /1 pieza/.test(aviso) && dialogos.length === 0,
      `toast="${aviso.replace(/\n/g, ' ')}" dialogos=${dialogos.length}`);

    // El aviso ofrece ir al cotizador para lo que exceda el inventario.
    await page.click('[data-ir-cotizador]');
    await page.waitForTimeout(400);
    const enCotizador = await page.locator('#view-quote').evaluate((s) => s.classList.contains('active'));
    check('el aviso lleva al cotizador', enCotizador);

    await page.evaluate(() => { localStorage.removeItem('hepsa_cart'); });
    await ctx.close();
  }

  // ── 9. Carrito ligado a la cuenta ────────────────────────────────────────
  {
    // Sesion A: arma un carrito estando dentro.
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await entrar(pageA, CUENTAS.cliente);
    await pageA.goto(`${BASE}/index.html`);
    await pageA.waitForSelector('[data-add-id]');
    await pageA.waitForFunction(() => usuarioActual !== null, null, { timeout: 8000 }).catch(() => {});
    await pageA.click('[data-add-id="5"]');
    await pageA.click('[data-add-id="5"]');
    await pageA.click('[data-add-id="3"]');
    await pageA.waitForTimeout(1500); // deja terminar el upsert

    const guardadoEnBase = await pageA.evaluate(async () => {
      const { data } = await window.supabaseClient
        .from('carrito_items').select('product_id, qty').order('product_id');
      return data;
    });
    check('el carrito se guarda en la cuenta',
      guardadoEnBase?.length === 2 && guardadoEnBase.find((r) => r.product_id === 5)?.qty === 2,
      JSON.stringify(guardadoEnBase));
    await ctxA.close();

    // Sesion B: otro navegador, sin localStorage. Debe recuperarlo.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await entrar(pageB, CUENTAS.cliente);
    await pageB.goto(`${BASE}/index.html`);
    await pageB.waitForSelector('[data-add-id]');
    await pageB.waitForFunction(() => cart.length > 0, null, { timeout: 8000 }).catch(() => {});
    const recuperado = await pageB.evaluate(() => cart.map(({ id, qty }) => ({ id, qty })));
    check('el carrito viaja entre dispositivos',
      recuperado.length === 2 && recuperado.find((l) => l.id === 5)?.qty === 2,
      JSON.stringify(recuperado));

    // Limpieza.
    await pageB.evaluate(async () => {
      await window.supabaseClient.from('carrito_items').delete().eq('user_id', usuarioActual);
      localStorage.removeItem('hepsa_cart');
    });
    await ctxB.close();

    // El carrito de un cliente es privado incluso para el staff.
    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await entrar(pageC, CUENTAS.admin);
    const ajeno = await pageC.evaluate(async () => {
      const { data } = await window.supabaseClient.from('carrito_items').select('*');
      return data?.length;
    });
    check('el admin no ve carritos ajenos', ajeno === 0, `filas=${ajeno}`);
    await ctxC.close();
  }

  // ── 10. Checkout ─────────────────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await entrar(page, CUENTAS.cliente);
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('[data-add-id]');
    await page.waitForFunction(() => usuarioActual !== null, null, { timeout: 8000 }).catch(() => {});

    // Un anonimo no debe poder crear pedidos.
    const ctxAnon = await browser.newContext();
    const pageAnon = await ctxAnon.newPage();
    await pageAnon.goto(`${BASE}/index.html`);
    await pageAnon.waitForFunction(() => window.supabaseClient !== undefined);
    const anon = await pageAnon.evaluate(async () => {
      const { error } = await window.supabaseClient.rpc('crear_pedido_desde_carrito', { p_notas: null });
      return error?.message ?? 'SIN ERROR';
    });
    check('el anonimo no puede crear pedidos', anon !== 'SIN ERROR', `respuesta=${anon}`);
    await ctxAnon.close();

    // La razon de que el checkout sea una funcion y no un INSERT: un cliente
    // no debe poder crear su propia orden con el total que se le antoje.
    const directo = await page.evaluate(async () => {
      const { error, data } = await window.supabaseClient.from('orders')
        .insert([{ client_id: usuarioActual, subtotal: 1, tax: 0, total: 1 }]).select();
      return { error: error?.message ?? null, filas: data?.length ?? 0 };
    });
    check('el cliente no puede insertar ordenes a mano',
      directo.filas === 0, `filas=${directo.filas} error=${JSON.stringify(directo.error)}`);

    // Carrito: 2 del producto 5 ($15,000) + 1 del 3 ($9,000) = $39,000 + IVA.
    await page.click('[data-add-id="5"]');
    await page.click('[data-add-id="5"]');
    await page.click('[data-add-id="3"]');
    await page.waitForTimeout(1200);

    await page.click('#cart-btn');
    await page.click('#btn-checkout');
    await page.waitForTimeout(2500);

    const aviso = await page.locator('#toast-container').innerText();
    check('el checkout confirma con folio', /Pedido #\d+ registrado/.test(aviso.replace(/\n/g, ' ')),
      `toast="${aviso.replace(/\n/g, ' ').slice(0, 90)}"`);

    const pedido = await page.evaluate(async () => {
      const { data } = await window.supabaseClient
        .from('orders').select('id, subtotal, tax, total, project_status, payment_status, client_email')
        .order('id', { ascending: false }).limit(1).single();
      const { data: items } = await window.supabaseClient
        .from('order_items').select('product_id, quantity, unit_price, custom_label')
        .eq('order_id', data.id).order('product_id');
      return { pedido: data, items };
    });

    check('el pedido guarda subtotal, IVA y total correctos',
      Number(pedido.pedido.subtotal) === 39000 &&
      Number(pedido.pedido.tax) === 6240 &&
      Number(pedido.pedido.total) === 45240,
      `subtotal=${pedido.pedido.subtotal} iva=${pedido.pedido.tax} total=${pedido.pedido.total}`);

    check('el pedido guarda sus renglones',
      pedido.items?.length === 2 && pedido.items.find((i) => i.product_id === 5)?.quantity === 2,
      JSON.stringify(pedido.items));

    check('nace sin pago y en cotizacion',
      pedido.pedido.payment_status === 'faltante' && pedido.pedido.project_status === 'cotizando',
      `${pedido.pedido.payment_status}/${pedido.pedido.project_status}`);

    const carritoTrasPedido = await page.evaluate(async () => {
      const { data } = await window.supabaseClient.from('carrito_items').select('product_id');
      return { base: data?.length, local: cart.length };
    });
    check('el carrito se vacia al confirmar',
      carritoTrasPedido.base === 0 && carritoTrasPedido.local === 0, JSON.stringify(carritoTrasPedido));

    // El pedido aparece en "Proyectos Activos", que antes se quedaba cargando.
    await page.waitForTimeout(800);
    const historial = await page.locator('#client-history-body').innerText();
    check('el pedido aparece en Proyectos Activos',
      new RegExp(`#${pedido.pedido.id}`).test(historial) && /Cotizando/i.test(historial),
      `tabla="${historial.replace(/\n/g, ' ').slice(0, 80)}"`);

    // Confirmar con el carrito vacio no debe crear otro pedido.
    await page.click('#cart-btn');
    await page.click('#btn-checkout');
    await page.waitForTimeout(1200);
    const cuantos = await page.evaluate(async () => {
      const { count } = await window.supabaseClient
        .from('orders').select('id', { count: 'exact', head: true });
      return count;
    });
    check('no se crean pedidos vacios', cuantos === 1, `pedidos=${cuantos}`);

    // Limpieza: borrar el pedido de prueba requiere admin.
    globalThis.__pedidoPrueba = pedido.pedido.id;
    await ctx.close();
  }

  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await entrar(page, CUENTAS.admin);
    // El staff sí debe ver el pedido del cliente: es su trabajo.
    const visto = await page.evaluate(async (id) => {
      const { data } = await window.supabaseClient.from('orders').select('id').eq('id', id);
      return data?.length;
    }, globalThis.__pedidoPrueba);
    check('el staff ve el pedido del cliente', visto === 1, `filas=${visto}`);

    await page.evaluate(async (id) => {
      await window.supabaseClient.from('orders').delete().eq('id', id);
    }, globalThis.__pedidoPrueba);
    await ctx.close();
  }

  // Releer como staff lo que el anonimo intento manipular.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await entrar(page, CUENTAS.admin);
    const fila = await page.evaluate(async (correo) => {
      const { data } = await window.supabaseClient
        .from('custom_requests').select('precio_estimado').eq('email', correo).single();
      return data?.precio_estimado;
    }, globalThis.__correoManipulado);
    check('el servidor reescribio el precio', Number(fila) === 7000, `guardado=${fila}`);

    // Limpieza de la fila de prueba.
    await page.evaluate(async (correo) => {
      await window.supabaseClient.from('custom_requests').delete().eq('email', correo);
    }, globalThis.__correoManipulado);
    await ctx.close();
  }
} finally {
  await browser.close();
}

const fallidas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas pasaron`);
process.exit(fallidas.length ? 1 : 0);
