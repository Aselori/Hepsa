// Regresion aislada del panel en pantallas angostas. Bloquea toda red externa
// y usa datos sinteticos, asi que no necesita Supabase, cuentas ni
// credenciales.
//
// Por que existe: el panel nunca tuvo diseno para movil. La barra lateral
// media siempre 260px, asi que en un telefono de 390px el contenido quedaba
// en una columna de unos 130px, con los formularios y el ticket cortados.
// El personal entra desde el telefono (ahi lee el codigo del segundo factor),
// asi que es un caso normal y no una rareza.
//
// La pagina no se desborda nunca a lo ancho porque <body> tiene overflow
// hidden: el desborde ocurre DENTRO de <main>. Por eso se mide <main> y no
// solo el documento.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const BASE_ORIGIN = new URL(BASE).origin;

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA' : 'FALLA'} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

// Lo que hace el panel cuando el servicio confirma el acceso, con datos de
// ejemplo en lugar de Supabase.
async function abrirPanel(browser, ancho, alto) {
  const context = await browser.newContext({ viewport: { width: ancho, height: alto } });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
    else await route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'domcontentloaded' });
  // Sin Supabase, la comprobacion de acceso del arranque falla y esconde el
  // panel tras su aviso de error. Se espera ese aviso y se deshace, que es
  // el estado en que queda la pagina cuando el acceso si se confirma.
  await page.waitForSelector('#access-error', { timeout: 15000 });
  await page.evaluate(async () => {
    document.getElementById('access-error').remove();
    for (const hijo of document.body.children) hijo.style.removeProperty('display');
    const datos = {
      products: [{ id: 'p-1', name: 'Porton residencial para cochera', description: 'Doble puerta, pintura electrostatica', price: 15000, stock: 2, is_active: true }],
      orders: [{ id: 'o-1', created_at: '2026-09-10T12:00:00Z', client_first_name: 'Mariana', client_last_name: 'Garza', client_phone: '8110000001', subtotal: 9700, tax: 1552, total: 11252, payment_status: 'anticipo', notes: 'Entregar por la tarde' }],
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
    document.body.style.display = 'flex';
    await cargarInventarioBD();
  });
  return { context, page };
}

// Mide si algo de la vista actual se sale de la pantalla y, si es asi, lo
// nombra para que una falla diga donde mirar.
async function desborde(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const borde = Math.min(main.getBoundingClientRect().right, window.innerWidth);
    // Lo que queda recortado dentro de una caja con desplazamiento propio
    // (la tira del menu, una tabla ancha) no cuenta: ahi se desliza.
    const recortado = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (a !== main && getComputedStyle(a).overflowX !== 'visible') return true; return false; };
    const fuera = [...document.body.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > borde + 0.5 && e.getClientRects().length && !recortado(e))
      .slice(0, 4).map(e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className ? '.' + String(e.className).trim().split(/\s+/).join('.') : ''}`);
    const ok = fuera.length === 0 && main.scrollWidth <= main.clientWidth;
    return { ok, detalle: ok ? '' : `main ${main.clientWidth}px, contenido ${main.scrollWidth}px${fuera.length ? ', sobresale: ' + fuera.join(' ') : ''}` };
  });
}

// elementFromPoint dice quien recibiria el toque: un boton puede estar
// dibujado y aun asi quedar tapado o fuera de la ventana.
async function recibeToque(page, selector) {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  return el.evaluate(boton => {
    const c = boton.getBoundingClientRect();
    if (c.x < 0 || c.x + c.width > window.innerWidth) return false;
    const encima = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
    return encima === boton || boton.contains(encima);
  });
}

const browser = await chromium.launch();
try {
  for (const [ancho, alto, etiqueta] of [[360, 740, 'telefono 360px'],
                                         [390, 844, 'telefono 390px'],
                                         [768, 1024, 'tablet 768px']]) {
    const { context, page } = await abrirPanel(browser, ancho, alto);

    const anchoFormulario = await page.evaluate(() => document.querySelector('#view-pos .panel').getBoundingClientRect().width);
    // Con el margen de 16px a cada lado, el formulario debe ocupar el resto.
    check(`${etiqueta}: el contenido usa todo el ancho`, anchoFormulario >= ancho - 2 * 16 - 2,
      `formulario ${Math.round(anchoFormulario)}px de ${ancho}px`);

    // Cada vista se alcanza desde el menu, se muestra al tocarla y no se sale
    // de la pantalla. Las tablas anchas (inventario, ventas) deben deslizarse
    // dentro de su caja, no ensanchar la vista entera.
    const vistas = ['pos', 'history', 'catalog', 'projects', 'users', 'config'];
    const malas = [];
    for (const vista of vistas) {
      if (!(await recibeToque(page, `#nav-${vista}`))) { malas.push(`${vista} sin toque`); continue; }
      await page.locator(`#nav-${vista}`).click();
      if (vista === 'history') await page.waitForSelector('#history-table-body .status-badge');
      await page.waitForTimeout(150);
      if (!(await page.locator(`#view-${vista}`).isVisible())) { malas.push(`${vista} no se muestra`); continue; }
      const medida = await desborde(page);
      check(`${etiqueta}: la vista ${vista} no se sale a lo ancho`, medida.ok, medida.detalle);
    }
    check(`${etiqueta}: las seis vistas se alcanzan y se abren`, malas.length === 0, malas.join(', '));

    await page.locator('#nav-pos').click();
    check(`${etiqueta}: Registrar Ticket recibe el toque`, await recibeToque(page, '#btn-registrar-venta'));
    check(`${etiqueta}: el boton de tema recibe el toque`, await recibeToque(page, '#theme-toggle'));
    check(`${etiqueta}: Tienda Web recibe el toque`, await recibeToque(page, '.btn-return'));
    // El dialogo de edicion cabe con margen a los lados y se puede guardar.
    await page.locator('#nav-catalog').click();
    await page.locator('.btn-edit').first().click();
    const dialogo = await page.evaluate(() => {
      const c = document.querySelector('#modal-edit-product .modal-box').getBoundingClientRect();
      return { izquierda: c.left, derecha: window.innerWidth - c.right };
    });
    check(`${etiqueta}: el dialogo de edicion deja margen a los lados`, dialogo.izquierda >= 8 && dialogo.derecha >= 8,
      `margenes ${Math.round(dialogo.izquierda)}px y ${Math.round(dialogo.derecha)}px`);
    check(`${etiqueta}: Guardar Cambios recibe el toque`, await recibeToque(page, '#modal-edit-product .action-btn'));
    await page.locator('#modal-edit-product .btn-cancel').click();

    // El rol es lo unico que dice con que permisos se entro: debe leerse entero.
    const rol = await page.evaluate(() => {
      const el = document.getElementById('user-role-display');
      el.innerText = 'Rol activo: vendedor';
      const c = el.getBoundingClientRect();
      return { entero: el.scrollWidth <= el.clientWidth, dentro: c.right <= window.innerWidth && c.width > 0 };
    });
    check(`${etiqueta}: el rol activo se lee entero`, rol.entero && rol.dentro);
    await context.close();
  }

  // Y que el escritorio siga con su barra lateral.
  const { context, page } = await abrirPanel(browser, 1366, 900);
  const escritorio = await page.evaluate(() => {
    const aside = document.querySelector('aside').getBoundingClientRect();
    const botones = [...document.querySelectorAll('.sidebar-nav button')].map(b => b.getBoundingClientRect());
    return {
      lateral: aside.x === 0 && aside.height === window.innerHeight && aside.width < 300,
      columna: botones.every(b => Math.abs(b.x - botones[0].x) < 1),
    };
  });
  check('escritorio 1366px: la barra lateral sigue a la izquierda y a toda altura', escritorio.lateral);
  check('escritorio 1366px: el menu sigue en una columna', escritorio.columna);

  // El ticket es papel blanco en los dos temas: su texto debe seguir oscuro
  // aunque el panel este en oscuro, o la etiqueta de estado no se lee.
  const tinta = await page.evaluate(() => ['claro', 'oscuro'].map(tema => {
    document.documentElement.dataset.tema = tema;
    const [r, g, b] = getComputedStyle(document.getElementById('tkt-status-badge')).color.match(/\d+/g).map(Number);
    return { tema, oscuro: r < 100 && g < 100 && b < 100, color: `${r},${g},${b}` };
  }));
  for (const t of tinta) check(`ticket en tema ${t.tema}: la etiqueta de estado va en tinta oscura`, t.oscuro, `rgb(${t.color})`);
  await context.close();
} finally {
  await browser.close();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones del panel en pantallas angostas.`);
if (fallidas) process.exitCode = 1;
