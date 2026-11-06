// Cuentas sinteticas y credenciales efimeras, exclusivamente en Supabase local.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';
import { codigoTOTPFresco } from './totp.mjs';
import { iniciarStripeSimulado } from './stripe-simulado.mjs';
import { contrasenaDePrueba } from './contrasena.mjs';

const estado = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const url = new URL(estado.API_URL);
if (url.origin !== 'http://127.0.0.1:55321') throw new Error('Se requiere el stack local HEPSA en 127.0.0.1:55321.');
const key = estado.PUBLISHABLE_KEY || estado.ANON_KEY;
const admin = createClient(url.origin, estado.SECRET_KEY || estado.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sdk = await build({ stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'supabase', platform: 'browser', write: false });
const env = { ...process.env, HEPSA_TEST_SUPABASE_URL: url.origin, HEPSA_TEST_SUPABASE_KEY: key };
const ids = [];
const clientes = [];
// Mejora 2: producto propio de la suite de pagos (el pago descuenta stock y no
// debe tocar el catalogo de ejemplo), Stripe simulado y Edge Functions.
let productoPagos = null;
let stripeSimulado = null;
let funciones = null;
let carpetaFunciones = null;
const archivos = new Map([
    ['/index.html', ['index.html', 'text/html']], ['/admin.html', ['admin.html', 'text/html']],
    ['/auth-mfa.js', ['auth-mfa.js', 'text/javascript']], ['/imagen.jpg', ['imagen.jpg', 'image/jpeg']],
    ['/assets/tema.css', ['assets/tema.css', 'text/css']], ['/assets/favicon.svg', ['assets/favicon.svg', 'image/svg+xml']],
    ['/assets/logo.svg', ['assets/logo.svg', 'image/svg+xml']], ['/assets/logo-dark.svg', ['assets/logo-dark.svg', 'image/svg+xml']],
    ['/assets/fonts/archivo-latin.woff2', ['assets/fonts/archivo-latin.woff2', 'font/woff2']],
]);
const server = createServer(async (req, res) => {
    const ruta = new URL(req.url, 'http://localhost').pathname;
    if (ruta === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(`window.HEPSA_CONFIG=${JSON.stringify({ supabaseUrl: url.origin, supabaseKey: key, storageBucket: 'productos', pagosEnLinea: true })};`);
        return;
    }
    if (ruta === '/supabase-sdk.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(sdk.outputFiles[0].text); return; }
    const archivo = archivos.get(ruta === '/' ? '/index.html' : ruta);
    if (!archivo) { res.writeHead(404).end(); return; }
    try {
        let contenido = await readFile(new URL(`../${archivo[0]}`, import.meta.url));
        if (archivo[1] === 'text/html') contenido = contenido.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/supabase-sdk.js');
        res.writeHead(200, { 'Content-Type': archivo[1], 'Cache-Control': 'no-store' }).end(contenido);
    } catch { res.writeHead(500).end(); }
});

try {
    for (const [prefix, role] of [['ADMIN', 'admin'], ['VENDEDOR', 'vendedor'], ['CLIENTE', 'cliente'], ['CLIENTE2', 'cliente']]) {
        const email = `prueba-${randomUUID()}@example.test`;
        const password = contrasenaDePrueba();
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: 'Prueba', last_name_p: prefix } });
        if (error) throw new Error(`No se pudo crear fixture ${prefix}: ${error.message}`);
        ids.push(data.user.id);
        const cambio = await admin.from('profiles').update({ role }).eq('id', data.user.id).select('id').single();
        if (cambio.error) throw cambio.error;
        env[`${prefix}_EMAIL`] = email;
        env[`${prefix}_PASS`] = password;
        if (role !== 'cliente') {
            const client = createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
            clientes.push(client);
            const login = await client.auth.signInWithPassword({ email, password });
            if (login.error) throw login.error;
            const factor = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HEPSA' });
            if (factor.error) throw factor.error;
            env[`${prefix}_TOTP`] = factor.data.totp.secret;
            const verificacion = await client.auth.mfa.challengeAndVerify({ factorId: factor.data.id, code: await codigoTOTPFresco(factor.data.totp.secret) });
            if (verificacion.error) throw verificacion.error;
        }
    }
    // Fixture del caso "usuario sin perfil". handle_new_user() crea la fila de
    // profiles al registrarse, asi que este estado no se alcanza por el camino
    // normal; se construye a proposito borrando la fila despues, que es lo que
    // quedaria si ese trigger fallara o si la cuenta naciera por la API
    // administrativa. Llega hasta AAL2 porque el agujero solo se abria ahi: a
    // AAL1, false AND NULL ya valia false.
    {
        const email = `huerfano-${randomUUID()}@example.test`;
        const password = contrasenaDePrueba();
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: 'Prueba', last_name_p: 'HUERFANO' } });
        if (error) throw new Error(`No se pudo crear el fixture sin perfil: ${error.message}`);
        ids.push(data.user.id);

        const client = createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
        clientes.push(client);
        const login = await client.auth.signInWithPassword({ email, password });
        if (login.error) throw login.error;
        const factor = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HEPSA' });
        if (factor.error) throw factor.error;
        const verificacion = await client.auth.mfa.challengeAndVerify({ factorId: factor.data.id, code: await codigoTOTPFresco(factor.data.totp.secret) });
        if (verificacion.error) throw verificacion.error;

        // El perfil se borra AL FINAL: crear la cuenta ya lo genera por trigger.
        const borrado = await admin.from('profiles').delete().eq('id', data.user.id).select('id');
        if (borrado.error) throw borrado.error;
        if (!borrado.data?.length) throw new Error('El fixture sin perfil no quedo sin perfil.');

        env.HUERFANO_EMAIL = email;
        env.HUERFANO_PASS = password;
        env.HUERFANO_TOTP = factor.data.totp.secret;
    }

    // Fixture del caso "role NULL". Antes de la capa 0 del arreglo, un usuario
    // con role NULL podia ascenderse a admin: is_admin() valia NULL a AAL2 y el
    // guardia del disparador (AND NOT is_admin()) no entraba en la rama.
    //
    // Ahora la base debe NEGARSE a guardar un role NULL. Se intenta de todos
    // modos y se anota el resultado, en vez de dar por hecho que la restriccion
    // existe: si alguien la quitara, la cuenta quedaria con role NULL y la suite
    // intentaria la escalada de verdad.
    {
        const email = `rolnulo-${randomUUID()}@example.test`;
        const password = contrasenaDePrueba();
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: 'Prueba', last_name_p: 'ROLNULO' } });
        if (error) throw new Error(`No se pudo crear el fixture de role NULL: ${error.message}`);
        ids.push(data.user.id);

        const client = createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
        clientes.push(client);
        const login = await client.auth.signInWithPassword({ email, password });
        if (login.error) throw login.error;
        const factor = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HEPSA' });
        if (factor.error) throw factor.error;
        const verificacion = await client.auth.mfa.challengeAndVerify({ factorId: factor.data.id, code: await codigoTOTPFresco(factor.data.totp.secret) });
        if (verificacion.error) throw verificacion.error;

        const nulo = await admin.from('profiles').update({ role: null }).eq('id', data.user.id).select('id');
        env.ROL_NULO_RECHAZADO = nulo.error ? 'si' : 'no';
        env.ROL_NULO_DETALLE = nulo.error ? nulo.error.message : 'la base acepto role NULL';
        env.ROLNULO_EMAIL = email;
        env.ROLNULO_PASS = password;
        env.ROLNULO_TOTP = factor.data.totp.secret;
    }

    await mkdir(new URL('./screenshots/', import.meta.url), { recursive: true });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    env.BASE_URL = `http://127.0.0.1:${server.address().port}`;

    {
        const { data, error } = await admin.from('products')
            .insert({ name: `Prueba de pagos ${randomUUID().slice(0, 8)}`, price: 1250, stock: 10, is_active: true })
            .select('id').single();
        if (error) throw new Error(`No se pudo crear el producto de pagos: ${error.message}`);
        productoPagos = data.id;
        env.PAGOS_PRODUCTO_ID = String(data.id);
    }

    // El simulado corre en la red de Supabase local, junto a las funciones.
    const proyecto = (await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8')).match(/^project_id\s*=\s*"([^"]+)"/m)[1];
    stripeSimulado = await iniciarStripeSimulado(`supabase_network_${proyecto}`);
    env.STRIPE_SIMULADO_URL = stripeSimulado.urlAnfitrion;
    env.STRIPE_WEBHOOK_SECRET = `whsec_${randomBytes(24).toString('hex')}`;
    carpetaFunciones = await mkdtemp(join(tmpdir(), 'hepsa-funciones-'));
    const archivoEnv = join(carpetaFunciones, 'funciones.env');
    await writeFile(archivoEnv, [
        'STRIPE_SECRET_KEY=sk_test_local_hepsa',
        `STRIPE_WEBHOOK_SECRET=${env.STRIPE_WEBHOOK_SECRET}`,
        `STRIPE_API_URL=${stripeSimulado.urlInterna}`,
        `HEPSA_SITIO_URL=${env.BASE_URL}`,
    ].join('\n') + '\n', { mode: 0o600 });
    funciones = spawn('node_modules/.bin/supabase', ['functions', 'serve', '--env-file', archivoEnv], { stdio: ['ignore', 'pipe', 'pipe'] });
    let bitacora = '';
    funciones.stdout.on('data', (c) => { bitacora += c; });
    funciones.stderr.on('data', (c) => { bitacora += c; });
    // Lista cuando crear-pago contesta su propio 401 (no el 503 de la pasarela).
    const limite = Date.now() + 240_000;
    for (;;) {
        const r = await fetch(`${url.origin}/functions/v1/crear-pago`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
        if (r?.status === 401) break;
        if (Date.now() > limite || funciones.exitCode !== null) throw new Error(`Las Edge Functions no arrancaron:\n${bitacora.slice(-2000)}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    for (const file of ['rls.spec.mjs', 'mfa-ui.spec.mjs', 'panel.spec.mjs', 'perfil-ausente.spec.mjs', 'rol-nulo.spec.mjs', 'recuperacion.spec.mjs', 'pagos.spec.mjs', 'contrasenas.spec.mjs']) {
        console.log(`Ejecutando ${file} contra Supabase local con cuentas desechables.`);
        const child = spawn(process.execPath, [new URL(file, import.meta.url).pathname], { env, stdio: 'inherit' });
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        if (code !== 0) { process.exitCode = 1; break; }
    }

    // Sin secretos de Stripe (como en el proyecto hospedado mientras no se
    // activan los pagos), las funciones deben contestar 503 "no configurado".
    // Stripe 23 lanza al crear su cliente sin llave; cuando se creaba al cargar
    // el módulo, las dos funciones morían con 500 y esto no se probaba, porque
    // la suite siempre les daba una llave.
    if (!process.exitCode) {
        const fin = new Promise((resolve) => funciones.once('exit', resolve));
        funciones.kill('SIGINT');
        await fin;
        funciones = spawn('node_modules/.bin/supabase', ['functions', 'serve'], { stdio: ['ignore', 'pipe', 'pipe'] });
        const respuestas = {};
        const limiteSinLlaves = Date.now() + 240_000;
        for (;;) {
            for (const f of ['crear-pago', 'webhook-stripe']) {
                const r = await fetch(`${url.origin}/functions/v1/${f}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
                respuestas[f] = r ? { status: r.status, cuerpo: (await r.text()).slice(0, 120) } : null;
            }
            // 503 de la pasarela ("name resolution failed") = todavía arrancando.
            const listas = Object.values(respuestas).every((x) => x && !/name resolution/i.test(x.cuerpo) && x.status !== 502);
            if (listas || Date.now() > limiteSinLlaves) break;
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        const ok = respuestas['crear-pago']?.status === 503 && /no están configurados/.test(respuestas['crear-pago'].cuerpo)
            && respuestas['webhook-stripe']?.status === 503 && /sin configurar/.test(respuestas['webhook-stripe'].cuerpo);
        console.log(`${ok ? 'PASA  ' : 'FALLA '} sin secretos de Stripe las funciones contestan 503, no 500  — ${JSON.stringify(respuestas)}`);
        if (!ok) process.exitCode = 1;
    }
} finally {
    for (const client of clientes) await client.auth.signOut();
    if (funciones && funciones.exitCode === null) {
        const fin = new Promise((resolve) => funciones.once('exit', resolve));
        funciones.kill('SIGINT');
        await fin;
    }
    if (stripeSimulado) await stripeSimulado.cerrar();
    if (carpetaFunciones) await rm(carpetaFunciones, { recursive: true, force: true });
    // Pedidos de las cuentas desechables, con sus pagos y renglones, antes de
    // borrar el producto que referencian.
    const pedidos = ids.length ? (await admin.from('orders').select('id').in('client_id', ids)).data ?? [] : [];
    const idsPedidos = pedidos.map((o) => o.id);
    if (idsPedidos.length) {
        const pagos = await admin.from('pagos').delete().in('order_id', idsPedidos);
        const renglones = await admin.from('order_items').delete().in('order_id', idsPedidos);
        const ordenes = await admin.from('orders').delete().in('id', idsPedidos);
        if (pagos.error || renglones.error || ordenes.error) { console.error('Fallo la limpieza de los pedidos de prueba.'); process.exitCode = 1; }
    }
    // rls.spec.mjs envia una solicitud como anonimo para comprobar que el precio
    // lo pone el servidor; el anonimo no puede borrarla, asi que se borra aqui.
    // Sin esto se acumulaban en la bandeja del panel local.
    const solicitudes = await admin.from('custom_requests').delete().like('email', '%@test.local');
    // contrasenas.spec.mjs se registra por el portal, sin pasar por ids[].
    const registradas = (await admin.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? [];
    for (const u of registradas.filter((x) => x.email?.endsWith('@contrasena.test'))) {
        await admin.from('profiles').delete().eq('id', u.id);
        const borrado = await admin.auth.admin.deleteUser(u.id);
        if (borrado.error) { console.error(`Fallo la limpieza de ${u.email}: ${borrado.error.message}`); process.exitCode = 1; }
    }
    if (solicitudes.error) { console.error(`Fallo la limpieza de las solicitudes de prueba: ${solicitudes.error.message}`); process.exitCode = 1; }
    if (productoPagos) {
        const borrado = await admin.from('products').delete().eq('id', productoPagos);
        if (borrado.error) { console.error(`Fallo la limpieza del producto de pagos: ${borrado.error.message}`); process.exitCode = 1; }
    }
    for (const id of ids) {
        // El esquema heredado no tiene cascade de auth.users a profiles/carrito.
        const carrito = await admin.from('carrito_items').delete().eq('user_id', id);
        const perfil = await admin.from('profiles').delete().eq('id', id);
        const usuario = await admin.auth.admin.deleteUser(id);
        if (carrito.error || perfil.error || usuario.error) { console.error('Fallo la limpieza de una cuenta local. Reinicia solo el stack de pruebas antes del siguiente intento.'); process.exitCode = 1; }
    }
    if (server.listening) await new Promise(resolve => server.close(resolve));
}
