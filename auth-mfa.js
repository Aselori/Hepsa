// La interfaz acompana las politicas RLS; nunca sustituye el control AAL2 en la base.
let mfaFactorId = null;
let mfaOcupado = false;
let mfaSesion = null;
let mfaFactores = [];
const esPersonal = (rol) => rol === 'vendedor' || rol === 'admin';

function limpiarSecretoMfa() {
    mfaFactorId = null;
    mfaFactores = [];
    document.getElementById('mfa-qr').removeAttribute('src');
    document.getElementById('mfa-secreto').textContent = '';
    document.getElementById('mfa-codigo').value = '';
    document.getElementById('mfa-alta').style.display = 'none';
    document.getElementById('mfa-factores-grupo').hidden = true;
    document.getElementById('mfa-factor').replaceChildren();
}

function estadoMfa(ocupado) {
    mfaOcupado = ocupado;
    document.getElementById('view-mfa').setAttribute('aria-busy', String(ocupado));
    document.getElementById('mfa-btn').disabled = ocupado || !mfaFactorId;
    document.getElementById('mfa-cancelar').disabled = ocupado;
    document.getElementById('mfa-reintentar').disabled = ocupado;
    document.getElementById('mfa-factor').disabled = ocupado;
    document.getElementById('mfa-codigo').disabled = ocupado || !mfaFactorId;
}

function errorMfa(mensaje, reintentar = false) {
    document.getElementById('mfa-error').textContent = mensaje;
    document.getElementById('mfa-reintentar').hidden = !reintentar;
}

function abrirVistaSegundoFactor() {
    showView('mfa');
    document.getElementById('mfa-codigo').value = '';
    if (mfaFactorId) document.getElementById('mfa-codigo').focus({ preventScroll: true });
    window.scrollTo(0, 0);
}

async function rolDelUsuario(userId) {
    const { data, error } = await window.supabaseClient
        .from('profiles').select('role').eq('id', userId).single();
    // Una consulta fallida no convierte al personal en cliente.
    if (error || !data || !['cliente', 'vendedor', 'admin'].includes(data.role)) {
        throw new Error('No se pudo comprobar tu acceso. Reintenta o cierra la sesión.');
    }
    return data.role;
}

async function mostrarRetoSegundoFactor() {
    const { data, error } = await window.supabaseClient.auth.mfa.listFactors();
    if (error || !data) throw new Error('No se pudieron consultar tus autenticadores. Reintenta.');
    mfaFactores = (data.totp || []).filter(f => f.status === 'verified');
    if (!mfaFactores.length) throw new Error('No hay un autenticador TOTP disponible. Contacta al responsable de HEPSA para recuperar tu acceso.');
    mfaFactorId = mfaFactores[0].id;
    const selector = document.getElementById('mfa-factor');
    selector.replaceChildren(...mfaFactores.map((factor, i) => {
        const option = document.createElement('option');
        option.value = factor.id;
        option.textContent = factor.friendly_name || `Autenticador ${i + 1}`;
        return option;
    }));
    document.getElementById('mfa-factores-grupo').hidden = mfaFactores.length < 2;
    document.getElementById('mfa-titulo').textContent = 'Verificación en dos pasos';
    document.getElementById('mfa-intro').textContent = 'Abre tu app autenticadora y escribe el código de 6 dígitos de HEPSA.';
    document.getElementById('mfa-btn').textContent = 'Verificar e ingresar';
}

function elegirFactorMfa() {
    const id = document.getElementById('mfa-factor').value;
    if (mfaOcupado || !mfaFactores.some(f => f.id === id)) return;
    mfaFactorId = id;
    document.getElementById('mfa-codigo').value = '';
    errorMfa('');
}

async function mostrarAltaSegundoFactor() {
    const { data: previos, error: errorLista } = await window.supabaseClient.auth.mfa.listFactors();
    if (errorLista || !previos) throw new Error('No se pudo preparar el autenticador. Reintenta.');
    // Solo limpiar altas incompletas que creo esta interfaz, nunca dispositivos ajenos.
    for (const factor of (previos.all || [])) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified' && factor.friendly_name === 'HEPSA') {
            const { error } = await window.supabaseClient.auth.mfa.unenroll({ factorId: factor.id });
            if (error) throw new Error('No se pudo limpiar el alta anterior. Reintenta; si persiste, contacta al responsable de HEPSA.');
        }
    }
    const { data, error } = await window.supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HEPSA' });
    if (error || !data?.totp) throw new Error('No se pudo iniciar el alta. Reintenta; si persiste, contacta al responsable de HEPSA.');
    mfaFactorId = data.id;
    document.getElementById('mfa-qr').src = data.totp.qr_code;
    document.getElementById('mfa-secreto').textContent = data.totp.secret;
    document.getElementById('mfa-alta').style.display = 'block';
    document.getElementById('mfa-titulo').textContent = 'Activa tu segundo factor';
    document.getElementById('mfa-intro').textContent = 'Tu cuenta de personal requiere un autenticador. Escanea el QR con tu app y confirma su código. Guarda la clave de forma privada; no la compartas.';
    document.getElementById('mfa-btn').textContent = 'Activar y entrar';
}

async function prepararSegundoFactor(session, recargar) {
    if (mfaOcupado) return;
    mfaSesion = session;
    limpiarSecretoMfa();
    errorMfa('');
    estadoMfa(true);
    try {
        if (!session?.user?.id) throw new Error('Tu sesión terminó. Cierra esta pantalla e inicia sesión de nuevo.');
        const { data: aal, error } = await window.supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error || !aal) throw new Error('No se pudo comprobar el segundo factor. Reintenta.');
        const rol = await rolDelUsuario(session.user.id);
        if (aal.currentLevel === 'aal2' || (aal.nextLevel !== 'aal2' && !esPersonal(rol))) {
            if (recargar) location.reload();
            return;
        }
        abrirVistaSegundoFactor();
        if (aal.nextLevel === 'aal2') await mostrarRetoSegundoFactor();
        else await mostrarAltaSegundoFactor();
    } catch (error) {
        abrirVistaSegundoFactor();
        errorMfa(error instanceof TypeError ? 'No hay conexión con el servicio. Reintenta.' : error.message, true);
    } finally {
        estadoMfa(false);
        if (mfaFactorId) document.getElementById('mfa-codigo').focus({ preventScroll: true });
    }
}

async function continuarDespuesDeContrasena(session) {
    return prepararSegundoFactor(session, true);
}

async function retomarSegundoFactorPendiente(session) {
    return prepararSegundoFactor(session, false);
}

async function reintentarSegundoFactor() {
    if (mfaOcupado) return;
    try {
        const { data, error } = await window.supabaseClient.auth.getSession();
        if (error) throw error;
        await prepararSegundoFactor(data.session, true);
    } catch {
        errorMfa('No se pudo recuperar tu sesión. Reintenta o cierra la sesión.', true);
    }
}

async function verificarSegundoFactor() {
    if (mfaOcupado || !mfaFactorId) return;
    const codigo = document.getElementById('mfa-codigo').value.trim();
    if (!/^\d{6}$/.test(codigo)) return errorMfa('Escribe los 6 dígitos del código.');
    errorMfa('');
    estadoMfa(true);
    const btn = document.getElementById('mfa-btn');
    const etiqueta = btn.textContent;
    btn.textContent = 'Verificando…';
    try {
        const { error } = await window.supabaseClient.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code: codigo });
        if (error) {
            const codigoInvalido = ['mfa_verification_failed', 'mfa_verification_rejected'].includes(error.code);
            errorMfa(codigoInvalido ? 'Código incorrecto o vencido. Usa el código actual de tu app.' : 'No se pudo verificar el código. Reintenta; si cambiaste de autenticador, vuelve a preparar el acceso.', !codigoInvalido);
            return;
        }
        limpiarSecretoMfa();
        location.reload();
    } catch {
        errorMfa('No hay conexión con el servicio. Reintenta la verificación.');
    } finally {
        document.getElementById('mfa-codigo').value = '';
        btn.textContent = etiqueta;
        estadoMfa(false);
    }
}

async function cancelarSegundoFactor() {
    if (mfaOcupado) return;
    estadoMfa(true);
    try {
        const { error } = await window.supabaseClient.auth.signOut({ scope: 'local' });
        if (error) throw error;
        limpiarSecretoMfa();
        mfaSesion = null;
        location.reload();
    } catch {
        errorMfa('No se pudo cerrar la sesión. Reintenta cancelar; tu acceso no se ha completado.');
    } finally {
        estadoMfa(false);
    }
}
