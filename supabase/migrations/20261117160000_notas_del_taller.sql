-- ============================================================================
-- NOTAS DE LOS PEDIDOS: el taller deja constancia de lo que pasa en producción
-- e instalación ("falta lámina de 14", "el cliente pidió cambiar la fecha").
--
-- orders.notes es de quien vende: es el texto del ticket y el cliente lo ve en
-- su perfil. Las notas del taller van en una tabla aparte por tres razones:
--   1. el taller no puede escribir en orders (tiene importes y pagos);
--   2. son internas: el cliente no las lee;
--   3. se agregan, no se sobrescriben: cada una guarda quién y cuándo.
--
-- Sólo expande: pedidos_de_taller() no cambia, así que el panel anterior sigue
-- funcionando con la base nueva y el nuevo tolera que la tabla no exista aún.
-- ============================================================================

CREATE TABLE public.notas_pedido (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id    bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    autor_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    -- Copia del nombre al escribir: el taller no lee profiles, y la nota debe
    -- seguir diciendo quién la escribió aunque la cuenta se borre después.
    autor_nombre text NOT NULL,
    autor_rol    public.user_role NOT NULL,
    texto        text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 1000),
    creado       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notas_pedido_pedido_idx ON public.notas_pedido (pedido_id, creado);

ALTER TABLE public.notas_pedido ENABLE ROW LEVEL SECURITY;

-- Se leen directo (no llevan precios); se escriben sólo por
-- agregar_nota_pedido(), que fija autor y fecha en el servidor.
REVOKE ALL ON public.notas_pedido FROM public, anon, authenticated;
GRANT SELECT ON public.notas_pedido TO authenticated;

CREATE POLICY "notas_pedido_select_personal" ON public.notas_pedido
    FOR SELECT TO authenticated
    USING (public.is_staff() OR public.es_taller());

CREATE OR REPLACE FUNCTION public.agregar_nota_pedido(p_pedido bigint, p_texto text)
    RETURNS public.notas_pedido
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
    AS $$
DECLARE
  v_texto  text := NULLIF(trim(p_texto), '');
  v_estado public.project_status;
  v_nota   public.notas_pedido;
BEGIN
  IF public.is_staff() IS NOT TRUE AND public.es_taller() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal puede agregar notas a un pedido';
  END IF;
  IF v_texto IS NULL THEN
    RAISE EXCEPTION 'La nota está vacía';
  END IF;
  IF char_length(v_texto) > 1000 THEN
    RAISE EXCEPTION 'La nota es demasiado larga (máximo 1000 caracteres)';
  END IF;

  SELECT project_status INTO v_estado FROM public.orders WHERE id = p_pedido;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido % no existe', p_pedido;
  END IF;
  -- El taller anota lo que ve en Producción; quien vende, cualquier pedido.
  IF public.is_staff() IS NOT TRUE AND v_estado NOT IN ('en_produccion', 'instalado') THEN
    RAISE EXCEPTION 'El taller sólo anota pedidos en producción o instalados';
  END IF;

  INSERT INTO public.notas_pedido (pedido_id, autor_id, autor_nombre, autor_rol, texto)
  SELECT p_pedido, p.id,
         COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name_p)), ''), p.email),
         p.role, v_texto
    FROM public.profiles p
   WHERE p.id = auth.uid()
  RETURNING * INTO v_nota;

  RETURN v_nota;
END;
$$;

REVOKE ALL ON FUNCTION public.agregar_nota_pedido(bigint, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.agregar_nota_pedido(bigint, text) TO authenticated;
