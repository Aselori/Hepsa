-- ============================================================================
-- CARRITO LIGADO A LA CUENTA
--
-- Hasta ahora el carrito vivía sólo en localStorage: quien armaba su pedido en
-- el celular no lo veía en la computadora, y al limpiar el navegador lo perdía.
--
-- Se guarda una fila por producto y no un blob JSON, para que la base pueda
-- garantizar lo que importa: que el producto exista, que la cantidad sea
-- positiva y que no haya dos líneas del mismo producto.
--
-- El anónimo sigue usando localStorage. Esta tabla es sólo para quien inició
-- sesión.
-- ============================================================================

CREATE TABLE public.carrito_items (
    user_id    uuid    NOT NULL,
    product_id bigint  NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    qty        integer NOT NULL CHECK (qty > 0 AND qty <= 999),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);

-- Si un producto se borra del catálogo, ON DELETE CASCADE limpia las líneas
-- solo; no quedan carritos apuntando a nada.

CREATE INDEX carrito_items_user_idx ON public.carrito_items (user_id);

ALTER TABLE public.carrito_items ENABLE ROW LEVEL SECURITY;

-- Un carrito es privado incluso para el staff: no hay razón para que un
-- vendedor vea lo que un cliente está considerando comprar.
CREATE POLICY "carrito_propio_select" ON public.carrito_items
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "carrito_propio_insert" ON public.carrito_items
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "carrito_propio_update" ON public.carrito_items
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "carrito_propio_delete" ON public.carrito_items
    FOR DELETE TO authenticated USING (user_id = auth.uid());

-- El user_id lo pone el servidor, no el cliente. Sin esto habría que confiar
-- en que el navegador mande el suyo, y la política de INSERT ya lo exige, pero
-- el default evita tener que mandarlo en cada upsert.
ALTER TABLE public.carrito_items ALTER COLUMN user_id SET DEFAULT auth.uid();
