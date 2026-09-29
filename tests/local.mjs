// Cuentas sinteticas y credenciales efimeras, exclusivamente en Supabase local.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';
import { codigoTOTPFresco } from './totp.mjs';

const estado = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const url = new URL(estado.API_URL);
if (url.origin !== 'http://127.0.0.1:55321') throw new Error('Se requiere el stack local HEPSA en 127.0.0.1:55321.');
const key = estado.PUBLISHABLE_KEY || estado.ANON_KEY;
const admin = createClient(url.origin, estado.SECRET_KEY || estado.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sdk = await build({ stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'supabase', platform: 'browser', write: false });
const env = { ...process.env, HEPSA_TEST_SUPABASE_URL: url.origin, HEPSA_TEST_SUPABASE_KEY: key };
const ids = [];
const clientes = [];
const archivos = new Map([
    ['/index.html', ['index.html', 'text/html']], ['/admin.html', ['admin.html', 'text/html']],
    ['/auth-mfa.js', ['auth-mfa.js', 'text/javascript']], ['/imagen.jpg', ['imagen.jpg', 'image/jpeg']],
]);
const server = createServer(async (req, res) => {
    const ruta = new URL(req.url, 'http://localhost').pathname;
    if (ruta === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(`window.HEPSA_CONFIG=${JSON.stringify({ supabaseUrl: url.origin, supabaseKey: key, storageBucket: 'productos' })};`);
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
    for (const [prefix, role] of [['ADMIN', 'admin'], ['VENDEDOR', 'vendedor'], ['CLIENTE', 'cliente']]) {
        const email = `prueba-${randomUUID()}@example.test`;
        const password = randomBytes(24).toString('base64url');
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
        const password = randomBytes(24).toString('base64url');
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
        const password = randomBytes(24).toString('base64url');
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
    for (const file of ['rls.spec.mjs', 'mfa-ui.spec.mjs', 'panel.spec.mjs', 'perfil-ausente.spec.mjs', 'rol-nulo.spec.mjs']) {
        console.log(`Ejecutando ${file} contra Supabase local con cuentas desechables.`);
        const child = spawn(process.execPath, [new URL(file, import.meta.url).pathname], { env, stdio: 'inherit' });
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        if (code !== 0) { process.exitCode = 1; break; }
    }
} finally {
    for (const client of clientes) await client.auth.signOut();
    for (const id of ids) {
        // El esquema heredado no tiene cascade de auth.users a profiles/carrito.
        const carrito = await admin.from('carrito_items').delete().eq('user_id', id);
        const perfil = await admin.from('profiles').delete().eq('id', id);
        const usuario = await admin.auth.admin.deleteUser(id);
        if (carrito.error || perfil.error || usuario.error) { console.error('Fallo la limpieza de una cuenta local. Reinicia solo el stack de pruebas antes del siguiente intento.'); process.exitCode = 1; }
    }
    if (server.listening) await new Promise(resolve => server.close(resolve));
}
