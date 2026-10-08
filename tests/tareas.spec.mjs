// Regresion aislada del diseño por tareas: cada pantalla muestra primero lo
// que su usuario necesita y deja en silencio lo normal. Red externa
// bloqueada y datos sinteticos: no necesita Supabase.
//
// Portal: la cotizacion pide la pieza antes que los datos personales y da el
// estimado sin pulsar nada; el contacto solo aparece si esta configurado; un
// producto sin foto no muestra una caja vacia.
// Panel: lo que falta cobrar, lo que esta por agotarse y lo que espera
// respuesta va primero y se cuenta arriba.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const BASE_ORIGIN = new URL(BASE).origin;

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA' : 'FALLA'} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
    else await route.abort();
  });
  const page = await context.newPage();
  const dialogos = [];
  page.on('dialog', async d => { dialogos.push(d.message()); await d.dismiss(); });

  // ── Portal ────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof cargarCatalogoPublico === 'function');
  await page.evaluate(async () => {
    const respuesta = Promise.resolve({ data: [{ id: 1, name: 'Porton', price: 15000, stock: 8, image_url: null }], error: null });
    const consulta = { select: () => consulta, eq: () => consulta, order: () => respuesta };
    window.supabaseClient = {
      ...window.supabaseClient,
      from: () => consulta,
      rpc: async (nombre) => nombre === 'calcular_precio' ? { data: 7000, error: null } : { data: null, error: null },
    };
    await cargarCatalogoPublico();
  });

  const tarjeta = await page.evaluate(() => {
    const card = document.querySelector('.product-card');
    return { cajaImagen: Boolean(card.querySelector('.card-img')), texto: card.textContent };
  });
  check('producto sin foto: no hay caja de imagen vacia', !tarjeta.cajaImagen && !/sin foto/i.test(tarjeta.texto));

  const empleados = await page.evaluate(() => ({
    enMenu: Boolean(document.querySelector('nav #btn-admin')),
    enPie: Boolean(document.querySelector('footer #btn-admin')),
  }));
  check('el portal de empleados esta al pie, no en el menu', !empleados.enMenu && empleados.enPie);

  const sinContacto = await page.evaluate(() => ({
    encabezado: document.getElementById('contacto-encabezado')?.hidden ?? false,
    cotizacion: document.getElementById('contacto-cotizacion')?.hidden ?? false,
    pie: document.getElementById('contacto-pie')?.childElementCount ?? -1,
  }));
  check('sin datos de contacto no se muestra nada de relleno',
    sinContacto.encabezado && sinContacto.cotizacion && sinContacto.pie === 0, JSON.stringify(sinContacto));

  const conContacto = await page.evaluate(() => {
    if (typeof pintarContacto !== 'function') return { encabezado: false, whatsapp: false, direccion: false };
    window.HEPSA_CONFIG.contacto = { telefono: '81 1234 5678', whatsapp: '528112345678', direccion: 'Av. Ejemplo 123' };
    pintarContacto();
    const enc = document.getElementById('contacto-encabezado');
    return {
      encabezado: !enc.hidden && enc.getAttribute('href') === 'tel:8112345678',
      whatsapp: [...document.querySelectorAll('#contacto-cotizacion a')].some(a => a.href === 'https://wa.me/528112345678'),
      direccion: document.getElementById('contacto-pie').textContent.includes('Av. Ejemplo 123'),
    };
  });
  check('con datos de contacto aparecen telefono, WhatsApp y direccion',
    conContacto.encabezado && conContacto.whatsapp && conContacto.direccion, JSON.stringify(conContacto));

  await page.evaluate(() => showView('quote'));
  const orden = await page.evaluate(() => {
    const antes = (a, b) => Boolean(document.getElementById(a).compareDocumentPosition(document.getElementById(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { piezaAntesQueNombre: antes('quote-largo', 'quote-n1'), estimadoAntesQueNombre: antes('quote-estimate', 'quote-n1') };
  });
  check('cotizar pide la pieza y da el estimado antes de los datos personales',
    orden.piezaAntesQueNombre && orden.estimadoAntesQueNombre, JSON.stringify(orden));

  const hayBotonCalcular = await page.evaluate(() => [...document.querySelectorAll('#view-quote button')].some(b => /calcular/i.test(b.textContent)));
  await page.fill('#quote-largo', '2000');
  await page.fill('#quote-alto', '1000');
  await page.selectOption('#quote-material', 'acero');
  await page.selectOption('#quote-acabado', 'cromado');
  await page.waitForTimeout(800);
  const estimado = await page.evaluate(() => ({
    visible: !document.getElementById('quote-estimate').hidden,
    monto: document.getElementById('quote-estimate-amount').textContent,
    detalle: document.getElementById('quote-estimate-detail').textContent,
    mayusculas: getComputedStyle(document.getElementById('quote-estimate-detail')).textTransform,
  }));
  check('el detalle del estimado dice "mm", no "Mm"', estimado.detalle.includes('1000 mm') && estimado.mayusculas !== 'capitalize', estimado.detalle);
  check('el estimado aparece solo al completar la pieza, sin boton',
    !hayBotonCalcular && estimado.visible && estimado.monto.includes('7,000'), JSON.stringify(estimado));

  await page.fill('#quote-largo', '50000');
  await page.waitForTimeout(800);
  const fueraDeRango = await page.locator('#quote-estimate-amount').innerText();
  check('una medida fuera de rango se avisa en el recuadro, sin ventana emergente',
    /20,000 mm/.test(fueraDeRango) && dialogos.length === 0, `aviso="${fueraDeRango}" ventanas=${dialogos.length}`);

  // ── Panel ─────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'domcontentloaded' });
  // Sin Supabase el arranque muestra su aviso de error; se deshace, que es el
  // estado en que queda la pagina cuando el acceso si se confirma.
  await page.waitForSelector('#access-error', { timeout: 15000 });
  await page.evaluate(async (fechas) => {
    document.getElementById('access-error').remove();
    for (const hijo of document.body.children) hijo.style.removeProperty('display');
    document.body.style.display = 'flex';
    const datos = {
      orders: [
        { id: 'o-pagada', created_at: fechas.hoy, client_first_name: 'Paga', client_last_name: 'Todo', total: 100, payment_status: 'completo' },
        { id: 'o-falta', created_at: fechas.ayer, client_first_name: 'Debe', client_last_name: 'Resto', total: 200, payment_status: 'faltante' },
        { id: 'o-anticipo', created_at: fechas.antier, client_first_name: 'Dejo', client_last_name: 'Anticipo', total: 300, payment_status: 'anticipo' },
      ],
      products: [
        { id: 'p-normal', name: 'Abeto', price: 100, stock: 10, is_active: true },
        { id: 'p-bajo', name: 'Barandal', price: 200, stock: 1, is_active: true },
        { id: 'p-oculto', name: 'Celosia', price: 300, stock: 5, is_active: false },
      ],
      custom_requests: [
        { id: 'r-hecha', created_at: fechas.hace10, first_name: 'Ya', last_name_p: 'Atendida', status: 'Finalizado', largo_mm: 1000, alto_mm: 1000, material: 'acero', acabado: 'pavonado' },
        { id: 'r-vieja', created_at: fechas.hace5, first_name: 'Espera', last_name_p: 'Mucho', phone: '81 1000 0001', email: 'a@b.test', status: 'Pendiente de Revisión', largo_mm: 1000, alto_mm: 1000, material: 'acero', acabado: 'pavonado' },
        { id: 'r-nueva', created_at: fechas.ayer, first_name: 'Espera', last_name_p: 'Poco', status: null, largo_mm: 1000, alto_mm: 1000, material: 'acero', acabado: 'pavonado' },
      ],
    };
    window.supabaseClient = {
      from(tabla) {
        const consulta = {
          select() { return consulta; },
          order() { return Promise.resolve({ data: datos[tabla] || [], error: null }); },
          then(ok, mal) { return Promise.resolve({ data: datos[tabla] || [], error: null }).then(ok, mal); },
        };
        return consulta;
      },
    };
    await cargarHistorialBD();
    await cargarInventarioBD();
    await cargarProyectosBD();
  }, { hoy: hace(0), ayer: hace(1), antier: hace(2), hace5: hace(5), hace10: hace(10) });

  const historial = await page.evaluate(() => ({
    resumen: document.getElementById('history-resumen')?.hidden === false ? document.getElementById('history-resumen').textContent : '',
    filas: [...document.querySelectorAll('#history-table-body tr')].map(tr => tr.classList.contains('fila-grupo') ? '|' : tr.children[1]?.textContent),
    pagadaSinMarca: [...document.querySelectorAll('#history-table-body tr')].find(tr => tr.textContent.includes('Paga Todo'))?.querySelector('.status-badge') === null,
  }));
  check('historial: lo que falta cobrar va primero y se cuenta arriba',
    historial.filas.join(',') === 'Debe Resto,Dejo Anticipo,|,Paga Todo' && /^2 ventas tienen pago pendiente/.test(historial.resumen),
    `${historial.filas.join(',')} / "${historial.resumen}"`);
  check('historial: una venta pagada no lleva marca de color', historial.pagadaSinMarca);

  const inventario = await page.evaluate(() => ({
    resumen: document.getElementById('inventory-resumen')?.textContent ?? '',
    filas: [...document.querySelectorAll('#inventory-table-body tr')].map(tr => tr.querySelector('strong').textContent + (tr.querySelector('.etiqueta-oculto') ? '(oculto)' : '')),
    columnaVisible: [...document.querySelectorAll('#view-catalog th')].some(th => /visible/i.test(th.textContent)),
    formularioPlegado: document.getElementById('panel-alta-producto')?.hidden ?? false,
  }));
  check('inventario: lo que se agota va primero y se cuenta arriba',
    inventario.filas[0] === 'Barandal' && /^1 producto está por agotarse/.test(inventario.resumen), `${inventario.filas.join(',')} / "${inventario.resumen}"`);
  check('inventario: solo lo oculto se marca, sin columna "Visible"',
    inventario.filas.includes('Celosia(oculto)') && inventario.filas.includes('Abeto') && !inventario.columnaVisible, inventario.filas.join(','));
  check('inventario: el alta de producto se abre a pedido', inventario.formularioPlegado);

  const proyectos = await page.evaluate(() => ({
    resumen: document.getElementById('projects-resumen')?.textContent ?? '',
    filas: [...document.querySelectorAll('#projects-table-body tr')].map(tr => tr.classList.contains('fila-grupo') ? '|' : tr.querySelector('strong')?.textContent),
    espera: document.querySelector('#projects-table-body tr .status-badge')?.textContent,
    esperaUrgente: document.querySelector('#projects-table-body tr .status-badge')?.classList.contains('status-peligro'),
    telefono: document.querySelector('#projects-table-body a[href^="tel:"]')?.getAttribute('href'),
  }));
  check('proyectos: lo que espera respuesta va primero, el mas antiguo arriba',
    proyectos.filas.join(',') === 'Espera Mucho,Espera Poco,|,Ya Atendida', proyectos.filas.join(','));
  check('proyectos: se ve cuanto lleva esperando y se cuenta arriba',
    proyectos.espera === '5 días' && proyectos.esperaUrgente && /^2 solicitudes sin responder; la más antigua espera desde hace 5 días/.test(proyectos.resumen),
    `${proyectos.espera} / "${proyectos.resumen}"`);
  check('proyectos: el telefono del cliente es un enlace', proyectos.telefono === 'tel:8110000001', proyectos.telefono);

  const pos = await page.evaluate(() => ({
    queAntesQueQuien: Boolean(document.getElementById('pos-product-select').compareDocumentPosition(document.getElementById('cli-nom1')) & Node.DOCUMENT_POSITION_FOLLOWING),
    menosUsadosPlegados: Boolean(document.getElementById('cli-ap-mat').closest('details:not([open])')),
  }));
  check('punto de venta: primero que se vende y despues para quien', pos.queAntesQueQuien);
  check('punto de venta: segundo nombre y apellido materno quedan plegados', pos.menosUsadosPlegados);

  const rol = await page.evaluate(() => document.body.textContent.includes('Rol activo') || document.body.textContent.includes('Panel de administración'));
  check('la barra lateral no repite "Rol activo" ni "Panel de administración"', !rol);
  await context.close();
} finally {
  await browser.close();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones del diseño por tareas.`);
if (fallidas) process.exitCode = 1;
