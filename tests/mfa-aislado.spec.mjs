// UI real, SDK simulado y red bloqueada. No demuestra RLS ni comportamiento del servidor Auth.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const original = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mfa = readFileSync(new URL('../auth-mfa.js', import.meta.url), 'utf8');
const html = original.replace(/<script src="[^"]+"><\/script>/g, '')
  .replace('    <script>', `    <script>${mfa}</script>\n    <script>`);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:18945';
const BASE_ORIGIN = new URL(BASE).origin;
const browser = await chromium.launch();
let total = 0;

async function escenario(nombre, run) {
    const context = await browser.newContext();
    try {
        await context.route('**/*', async route => {
            if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === BASE_ORIGIN) {
                await route.fulfill({ contentType: 'text/html', body: html });
            } else {
                await route.abort();
            }
        });
        await context.addInitScript(() => {
            window.HEPSA_CONFIG = {};
            window.estadoPrueba = {
                session: { user: { id: 'empleado-sintetico' } }, rol: 'vendedor',
                aal: { currentLevel: 'aal1', nextLevel: 'aal2' },
                factores: [{ id: 'factor-1', status: 'verified', factor_type: 'totp', friendly_name: 'Principal' }],
                llamadas: [],
            };
            const t = window.estadoPrueba;
            window.supabaseClient = {
                from() { return { select() { return this; }, eq() { return this; },
                    single: async () => ({ data: t.sinPerfil ? null : { role: t.rol }, error: t.errorRol }) }; },
                auth: {
                    getSession: async () => ({ data: { session: t.session }, error: t.errorSesion }),
                    signOut: async () => { t.llamadas.push('signOut'); return { error: t.errorSalir }; },
                    mfa: {
                        getAuthenticatorAssuranceLevel: async () => ({ data: t.aal, error: t.errorAal }),
                        listFactors: async () => ({ data: { all: t.factores, totp: t.factores.filter(f => f.factor_type === 'totp' && f.status === 'verified') }, error: t.errorLista }),
                        unenroll: async ({ factorId }) => { t.llamadas.push(['unenroll', factorId]); return { error: t.errorLimpiar }; },
                        enroll: async () => { t.llamadas.push('enroll'); return { error: t.errorAlta, data: { id: 'nuevo', totp: { qr_code: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E', secret: 'SOLO-SINTETICO' } } }; },
                        challengeAndVerify: async (args) => {
                            t.llamadas.push(['verify', args]);
                            if (t.esperar) await new Promise(resolve => { window.resolverVerificacion = resolve; });
                            if (t.errorRed) throw new TypeError('NetworkError');
                            return { error: t.errorCodigo };
                        },
                    },
                },
            };
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.on('pageerror', error => console.error('ERROR PAGINA', error.message));
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await run(page);
        total++;
        console.log(`PASA ${nombre}`);
    } finally { await context.close(); }
}
const preparar = page => page.evaluate(() => retomarSegundoFactorPendiente(window.estadoPrueba.session));
const set = (page, values) => page.evaluate(values => Object.assign(window.estadoPrueba, values), values);

try {
    await escenario('rol desconocido muestra error y permite reintentar sin asumir cliente', async page => {
        await set(page, { errorRol: { message: 'fallo' } });
        await preparar(page);
        assert.match(await page.locator('#mfa-error').textContent(), /comprobar tu acceso/);
        assert.equal(await page.locator('#mfa-btn').isDisabled(), true);
        await set(page, { errorRol: null });
        await page.click('#mfa-reintentar');
        await page.waitForFunction(() => !document.getElementById('mfa-btn').disabled);
        assert.equal(await page.locator('#mfa-error').textContent(), '');
    });
    await escenario('fallo AAL o lista no permite verificar', async page => {
        await set(page, { errorAal: { message: 'offline' } });
        await preparar(page);
        assert.equal(await page.locator('#mfa-reintentar').isVisible(), true);
        assert.equal(await page.locator('#mfa-btn').isDisabled(), true);
        await set(page, { errorAal: null, errorLista: { message: 'offline' } });
        await preparar(page);
        assert.match(await page.locator('#mfa-error').textContent(), /consultar tus autenticadores/);
    });
    await escenario('alta limpia solo el factor HEPSA incompleto y falla de forma recuperable', async page => {
        await set(page, { aal: { currentLevel: 'aal1', nextLevel: 'aal1' }, factores: [
            { id: 'viejo', status: 'unverified', factor_type: 'totp', friendly_name: 'HEPSA' },
            { id: 'ajeno', status: 'unverified', factor_type: 'totp', friendly_name: 'Otra app' },
        ], errorLimpiar: { message: 'offline' } });
        await preparar(page);
        assert.deepEqual(await page.evaluate(() => estadoPrueba.llamadas), [['unenroll', 'viejo']]);
        assert.equal(await page.locator('#mfa-secreto').textContent(), '');
        await set(page, { errorLimpiar: null });
        await preparar(page);
        assert.equal(await page.locator('#mfa-secreto').textContent(), 'SOLO-SINTETICO');
        assert.equal(await page.locator('#mfa-btn').isEnabled(), true);
        assert.equal(await page.evaluate(() => estadoPrueba.llamadas.some(x => x[1] === 'ajeno')), false);
    });
    await escenario('elige factor alternativo y bloquea doble envio incluso con Enter', async page => {
        await set(page, { factores: [
            { id: 'uno', status: 'verified', factor_type: 'totp', friendly_name: '<img src=x onerror=alert(1)>' },
            { id: 'dos', status: 'verified', factor_type: 'totp', friendly_name: 'Respaldo' },
        ], esperar: true, errorCodigo: { code: 'mfa_verification_failed' } });
        await preparar(page);
        await page.selectOption('#mfa-factor', 'dos');
        await page.fill('#mfa-codigo', '123456');
        await page.click('#mfa-btn');
        await page.evaluate(() => verificarSegundoFactor());
        assert.equal(await page.locator('#mfa-cancelar').isDisabled(), true);
        const llamadas = await page.evaluate(() => estadoPrueba.llamadas);
        assert.deepEqual(llamadas, [['verify', { factorId: 'dos', code: '123456' }]]);
        await page.evaluate(() => resolverVerificacion());
        await page.waitForFunction(() => !document.getElementById('mfa-btn').disabled);
        assert.match(await page.locator('#mfa-error').textContent(), /incorrecto o vencido/);
        assert.equal(await page.locator('#mfa-codigo').inputValue(), '');
        assert.equal(await page.locator('#mfa-factor img').count(), 0);
    });
    await escenario('codigo invalido local no llama Auth y una caida de red permite reintentar', async page => {
        await preparar(page);
        await page.fill('#mfa-codigo', '12a456');
        await page.click('#mfa-btn');
        assert.deepEqual(await page.evaluate(() => estadoPrueba.llamadas), []);
        await set(page, { errorRed: true });
        await page.fill('#mfa-codigo', '123456');
        await page.click('#mfa-btn');
        await page.waitForFunction(() => !document.getElementById('mfa-btn').disabled);
        assert.match(await page.locator('#mfa-error').textContent(), /conexión/);
    });
    await escenario('cancelacion fallida conserva error; cancelacion exitosa limpia al recargar', async page => {
        await set(page, { aal: { currentLevel: 'aal1', nextLevel: 'aal1' }, factores: [], errorSalir: { message: 'offline' } });
        await preparar(page);
        await page.click('#mfa-cancelar');
        await page.waitForFunction(() => !document.getElementById('mfa-cancelar').disabled);
        assert.match(await page.locator('#mfa-error').textContent(), /cerrar la sesión/);
        await set(page, { errorSalir: null });
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#mfa-cancelar')]);
        assert.equal(await page.locator('#mfa-secreto').textContent(), '');
        assert.equal(await page.locator('#mfa-qr').getAttribute('src'), null);
    });
    await escenario('verificacion exitosa recarga y elimina secreto de alta', async page => {
        await set(page, { aal: { currentLevel: 'aal1', nextLevel: 'aal1' }, factores: [] });
        await preparar(page);
        await page.fill('#mfa-codigo', '123456');
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#mfa-btn')]);
        assert.equal(await page.locator('#mfa-secreto').textContent(), '');
    });
    await escenario('cliente sin factor y personal AAL2 no necesitan alta; sesion ausente falla cerrada', async page => {
        await set(page, { rol: 'cliente', aal: { currentLevel: 'aal1', nextLevel: 'aal1' } });
        await preparar(page);
        assert.equal(await page.locator('#view-mfa').isVisible(), false);
        await set(page, { rol: 'admin', aal: { currentLevel: 'aal2', nextLevel: 'aal2' } });
        await preparar(page);
        assert.equal(await page.locator('#view-mfa').isVisible(), false);
        await set(page, { session: null });
        await preparar(page);
        assert.match(await page.locator('#mfa-error').textContent(), /sesión terminó/);
    });
    console.log(`${total} escenarios MFA aislados correctos.`);
} finally { await browser.close(); }
