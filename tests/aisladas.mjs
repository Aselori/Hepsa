// Publica exclusivamente los archivos de la app, nunca tests/.env.local ni respaldos.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const archivos = new Map([
    ['/index.html', ['index.html', 'text/html']], ['/admin.html', ['admin.html', 'text/html']],
    ['/config.js', ['config.js', 'text/javascript']], ['/auth-mfa.js', ['auth-mfa.js', 'text/javascript']],
    ['/imagen.jpg', ['imagen.jpg', 'image/jpeg']],
    ['/assets/tema.css', ['assets/tema.css', 'text/css']], ['/assets/favicon.svg', ['assets/favicon.svg', 'image/svg+xml']],
    ['/assets/logo.svg', ['assets/logo.svg', 'image/svg+xml']], ['/assets/logo-dark.svg', ['assets/logo-dark.svg', 'image/svg+xml']],
    ['/assets/fonts/archivo-latin.woff2', ['assets/fonts/archivo-latin.woff2', 'font/woff2']],
]);
const server = createServer(async (req, res) => {
    const ruta = new URL(req.url, 'http://localhost').pathname;
    const archivo = archivos.get(ruta === '/' ? '/index.html' : ruta);
    if (!archivo) { res.writeHead(404).end(); return; }
    try {
        const body = await readFile(new URL(`../${archivo[0]}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': archivo[1], 'Cache-Control': 'no-store' }).end(body);
    } catch { res.writeHead(500).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
try {
    for (const archivo of ['admin-rendering.spec.mjs', 'mfa-aislado.spec.mjs', 'responsivo.spec.mjs', 'catalogo-imagen.spec.mjs']) {
        const child = spawn(process.execPath, [new URL(archivo, import.meta.url).pathname], {
            stdio: 'inherit', env: { ...process.env, BASE_URL: `http://127.0.0.1:${server.address().port}` },
        });
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        if (code !== 0) { process.exitCode = 1; break; }
    }
} finally { await new Promise(resolve => server.close(resolve)); }
