// Demo manual local. Crea cuentas sin factor para probar el alta en un telefono.
// Las credenciales se guardan fuera del repositorio y nunca se sirven por HTTP.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';

const estado = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const url = new URL(estado.API_URL);
if (url.origin !== 'http://127.0.0.1:55321') throw new Error('Se requiere el stack local HEPSA en 127.0.0.1:55321.');
const key = estado.PUBLISHABLE_KEY || estado.ANON_KEY;
const admin = createClient(url.origin, estado.SECRET_KEY || estado.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sdk = await build({ stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'supabase', platform: 'browser', write: false });

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

let cuentas = [];
try {
    const anterior = JSON.parse(await readFile('/tmp/hepsa-demo-access.json', 'utf8'));
    if (anterior.url === 'http://127.0.0.1:8000' && anterior.accounts?.length === 3) {
        for (const cuenta of anterior.accounts) {
            const perfil = await admin.from('profiles').select('role').eq('email', cuenta.email).single();
            if (perfil.error || perfil.data.role !== cuenta.role) throw new Error('Las cuentas guardadas no coinciden con el stack local.');
        }
        cuentas = anterior.accounts;
    }
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}
const etiqueta = randomUUID().slice(0, 8);
for (const role of (cuentas.length ? [] : ['admin', 'vendedor', 'cliente'])) {
    const email = `${role}-${etiqueta}@example.test`;
    const password = randomBytes(15).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { first_name: 'Demo', last_name_p: role } });
    if (error) throw error;
    const cambio = await admin.from('profiles').update({ role }).eq('id', data.user.id).select('id').single();
    if (cambio.error) throw cambio.error;
    cuentas.push({ role, email, password });
}
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8000, '127.0.0.1', resolve); });
const acceso = { url: 'http://127.0.0.1:8000', accounts: cuentas };
await writeFile('/tmp/hepsa-demo-access.json', JSON.stringify(acceso, null, 2), { mode: 0o600 });
console.log('Demo HEPSA lista en http://127.0.0.1:8000');
console.log('Credenciales locales: /tmp/hepsa-demo-access.json (no servido por HTTP).');
// Conservar cuentas al salir para no perder autenticadores inscritos por la persona.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
