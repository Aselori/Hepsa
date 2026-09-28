import { chromium } from 'playwright';

export function exigirLoopback(valor, nombre) {
    const url = new URL(valor);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new Error(`${nombre} debe apuntar al entorno local HTTP, nunca al proyecto compartido.`);
    }
    return url.origin;
}

export const BASE = exigirLoopback(process.env.BASE_URL || 'http://localhost:8000', 'BASE_URL');
if (!process.env.HEPSA_TEST_SUPABASE_URL || !process.env.HEPSA_TEST_SUPABASE_KEY) {
    throw new Error('Estas suites modifican datos. Ejecuta npm run test:local para crear cuentas locales aisladas.');
}
export const URL_SB = exigirLoopback(process.env.HEPSA_TEST_SUPABASE_URL, 'HEPSA_TEST_SUPABASE_URL');
export const LLAVE = process.env.HEPSA_TEST_SUPABASE_KEY;

export async function navegadorLocal() {
    const browser = await chromium.launch();
    const crearContexto = browser.newContext.bind(browser);
    browser.newContext = async options => {
        const context = await crearContexto(options);
        // Bloqueo independiente de config.js: un error de configuracion no escribe en produccion.
        await context.route('**/*', route => {
            const origin = new URL(route.request().url()).origin;
            return [BASE, URL_SB].includes(origin) ? route.continue() : route.abort();
        });
        return context;
    };
    return browser;
}
