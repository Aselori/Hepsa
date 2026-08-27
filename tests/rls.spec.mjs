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
} finally {
  await browser.close();
}

const fallidas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas pasaron`);
process.exit(fallidas.length ? 1 : 0);
