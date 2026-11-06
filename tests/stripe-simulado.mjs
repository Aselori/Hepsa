// Stripe simulado para las pruebas locales de la Mejora 2.
//
// La Edge Function crear-pago corre dentro de Docker y, con STRIPE_API_URL,
// le habla a este servidor en vez de a api.stripe.com. Así la suite no
// necesita llaves reales ni red, y puede revisar qué se le pidió a Stripe:
// sobre todo, que el monto salió de la base y no del navegador.
//
// El simulado también corre en un contenedor, en la red de Supabase local.
// Escuchar en el anfitrión no sirve en todas las máquinas: un firewall como
// ufw descarta lo que llega de las redes de Docker a puertos del anfitrión, y
// la función se quedaba esperando hasta el 504.
//
// Este archivo tiene dos papeles: ejecutado con node dentro del contenedor es
// el servidor; importado desde tests/local.mjs, levanta ese contenedor.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PUERTO = 12111;
const IMAGEN = 'node:22.23.4-alpine';

function servir() {
    const sesiones = [];
    createServer((req, res) => {
        let cuerpo = '';
        req.on('data', (c) => { cuerpo += c; });
        req.on('end', () => {
            const ruta = new URL(req.url, 'http://x').pathname;
            if (req.method === 'POST' && ruta === '/v1/checkout/sessions') {
                // El SDK manda application/x-www-form-urlencoded con claves
                // anidadas, p. ej. line_items[0][price_data][unit_amount].
                const campos = Object.fromEntries(new URLSearchParams(cuerpo));
                const id = `cs_test_${randomBytes(12).toString('hex')}`;
                sesiones.push({ id, autorizacion: req.headers.authorization, campos });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Request-Id': `req_${id}` });
                res.end(JSON.stringify({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}` }));
                return;
            }
            // La suite corre en otro proceso: así consulta lo que se pidió.
            if (req.method === 'GET' && ruta === '/__sesiones') {
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(sesiones));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: `Ruta no simulada: ${req.method} ${ruta}` } }));
        });
    }).listen(PUERTO, '0.0.0.0');
}

// Levanta el contenedor en la red de Supabase local. Devuelve la URL con la
// que lo ven las funciones (por nombre de contenedor) y la que usa la suite
// desde el anfitrión (puerto publicado sólo en 127.0.0.1).
export async function iniciarStripeSimulado(red) {
    const nombre = `hepsa-stripe-simulado-${randomBytes(4).toString('hex')}`;
    execFileSync('docker', ['run', '-d', '--rm', '--name', nombre, '--network', red,
        '-p', `127.0.0.1::${PUERTO}`,
        '-v', `${fileURLToPath(import.meta.url)}:/app/stripe-simulado.mjs:ro`,
        IMAGEN, 'node', '/app/stripe-simulado.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const cerrar = async () => { try { execFileSync('docker', ['rm', '-f', nombre], { stdio: 'ignore' }); } catch { /* ya no estaba */ } };
    try {
        const publicado = execFileSync('docker', ['port', nombre, String(PUERTO)], { encoding: 'utf8' }).trim().split('\n')[0];
        const urlAnfitrion = `http://${publicado}`;
        const limite = Date.now() + 30_000;
        while (!(await fetch(`${urlAnfitrion}/__sesiones`).then((r) => r.ok).catch(() => false))) {
            if (Date.now() > limite) throw new Error('El Stripe simulado no arrancó.');
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return { urlInterna: `http://${nombre}:${PUERTO}`, urlAnfitrion, cerrar };
    } catch (e) {
        await cerrar();
        throw e;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) servir();
