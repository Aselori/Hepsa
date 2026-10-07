// ============================================================================
// Configuración de Supabase: único lugar donde viven URL y llave.
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
    storageBucket: 'productos',

    // Datos de contacto que el portal muestra en el encabezado, junto al
    // estimado de la cotización y al pie. Un campo vacío no se muestra, así
    // que el sitio nunca enseña un dato a medias o de relleno.
    //   telefono:  como se lee, por ejemplo '81 1234 5678'
    //   whatsapp:  con lada de país, por ejemplo '528112345678' (para wa.me)
    //   direccion: una línea, por ejemplo 'Av. Ejemplo 123, Monterrey, N.L.'
    contacto: { telefono: '', whatsapp: '', direccion: '' },

    // ¿Se puede pedir más de lo que hay en existencia?
    //
    // NO se configura aquí. Vive en la base, en parametros_cotizacion:
    //
    //   UPDATE public.parametros_cotizacion
    //      SET valor = 1            -- 1 = se acepta sobre pedido, 0 = topa en stock
    //    WHERE clave = 'permitir_sobre_pedido';
    //
    // Está allá y no aquí porque el checkout también tiene que respetarla, y
    // una regla escrita en dos lados acaba con las dos mitades en desacuerdo:
    // el navegador dejaría pedir lo que el servidor luego rechaza. El portal
    // la consulta al arrancar con permite_sobre_pedido().
};
