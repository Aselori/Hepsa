// ============================================================================
// Configuración de Supabase — único lugar donde viven URL y llave.
//
// Para apuntar a otro proyecto (el de desarrollo, el del cliente), se cambia
// aquí y nada más. Antes estaba duplicada en index.html y admin.html, así que
// era fácil mover una y olvidar la otra.
//
// La publishable key NO es un secreto: está diseñada para viajar al navegador
// y lo que protege los datos son las políticas RLS, no ocultarla. La llave que
// jamás debe aparecer en este archivo (ni en ningún archivo del repo) es la
// service_role, que se salta RLS por completo.
// ============================================================================

window.HEPSA_CONFIG = {
    supabaseUrl: 'https://qmyrosmuqfabaedzydsa.supabase.co',
    supabaseKey: 'sb_publishable_q8vR1rTo4nvlYzrTTPubew_5Cv0wW0x',

    // Nombre del bucket de Storage. El código usaba 'product-images', pero el
    // bucket real siempre se llamó 'productos'; por eso fallaba subir imágenes.
    storageBucket: 'productos'
};
