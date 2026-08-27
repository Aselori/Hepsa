-- ============================================================================
-- COTIZADOR ESTRUCTURADO
--
-- Cierra el pilar de "Estandarización" prometido al cliente: forzar la captura
-- de Medidas, Materiales y Acabados en vez de un textarea libre.
--
-- Antes: custom_requests.specifications era una sola columna de texto donde el
-- cliente escribía "portón de 5 x 3 m, acero, pintura negra". Imposible de
-- filtrar, de comparar o de cotizar. Ahora esos datos son columnas reales con
-- restricciones, y specifications queda como notas opcionales.
--
-- El precio se calcula EN LA BASE, no en el navegador. Si viviera en el JS, el
-- cliente podría mandar el precio que quisiera en el insert.
-- ============================================================================

-- ─── Vocabulario ────────────────────────────────────────────────────────────

CREATE TYPE public.material_tipo AS ENUM ('acero', 'hierro_forjado', 'aluminio');
CREATE TYPE public.acabado_tipo  AS ENUM ('pintura_electrostatica', 'pavonado', 'cromado');

-- ─── Columnas nuevas ────────────────────────────────────────────────────────

ALTER TABLE public.custom_requests
  ADD COLUMN largo_mm        integer,
  ADD COLUMN alto_mm         integer,
  -- Opcional a propósito: un barandal o un protector plano no tienen
  -- profundidad significativa. Obligar a inventar un número daría datos peores
  -- que dejarlo vacío.
  ADD COLUMN profundidad_mm  integer,
  ADD COLUMN material        public.material_tipo,
  ADD COLUMN acabado         public.acabado_tipo,
  ADD COLUMN precio_estimado numeric(12,2);

-- ─── Relleno de las solicitudes que ya existían ─────────────────────────────

-- Las 3 filas del seed son ejemplos inventados con las medidas dentro del
-- texto. Se traducen a columnas para poder marcarlas NOT NULL.
UPDATE public.custom_requests SET
  largo_mm = 1670, alto_mm = 1240, profundidad_mm = 150,
  material = 'acero', acabado = 'pintura_electrostatica'
WHERE specifications LIKE '%protector de ventana%';

UPDATE public.custom_requests SET
  largo_mm = 5000, alto_mm = 3000,
  material = 'acero', acabado = 'pintura_electrostatica'
WHERE specifications LIKE '%port%n de 5 x 3%';

UPDATE public.custom_requests SET
  largo_mm = 4000, alto_mm = 1000,
  material = 'hierro_forjado', acabado = 'pavonado'
WHERE specifications LIKE '%Barandal%';

-- ─── Restricciones: aquí es donde la captura se vuelve estricta ─────────────

ALTER TABLE public.custom_requests
  ALTER COLUMN largo_mm SET NOT NULL,
  ALTER COLUMN alto_mm  SET NOT NULL,
  ALTER COLUMN material SET NOT NULL,
  ALTER COLUMN acabado  SET NOT NULL;

-- Cotas en milímetros: 10 mm a 20 m. Atrapan tanto el cero y los negativos
-- como el error de dedo de quien captura metros donde van milímetros.
ALTER TABLE public.custom_requests
  ADD CONSTRAINT custom_requests_largo_valido
      CHECK (largo_mm BETWEEN 10 AND 20000),
  ADD CONSTRAINT custom_requests_alto_valido
      CHECK (alto_mm BETWEEN 10 AND 20000),
  ADD CONSTRAINT custom_requests_profundidad_valida
      CHECK (profundidad_mm IS NULL OR profundidad_mm BETWEEN 10 AND 5000);

COMMENT ON COLUMN public.custom_requests.specifications IS
  'Notas libres del cliente. Ya no es la fuente de las medidas: eso vive en las columnas.';

-- ─── Tarifario ──────────────────────────────────────────────────────────────

-- Vive en tablas, no en el código, para que el negocio ajuste precios sin
-- necesitar un despliegue.
CREATE TABLE public.tarifas_material (
    material    public.material_tipo PRIMARY KEY,
    precio_m2   numeric(12,2) NOT NULL CHECK (precio_m2 > 0),
    actualizado timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tarifas_acabado (
    acabado     public.acabado_tipo PRIMARY KEY,
    factor      numeric(5,2) NOT NULL CHECK (factor > 0),
    actualizado timestamptz NOT NULL DEFAULT now()
);

-- OJO: valores PROVISIONALES. Se sacaron del rango que ya se cobra en el
-- catálogo actual (entre ~$2,000 y ~$3,300 por m²), pero HEPSA tiene que
-- confirmarlos. No son precios reales todavía.
INSERT INTO public.tarifas_material (material, precio_m2) VALUES
  ('acero',          2500.00),
  ('hierro_forjado', 3500.00),
  ('aluminio',       2000.00);

INSERT INTO public.tarifas_acabado (acabado, factor) VALUES
  ('pintura_electrostatica', 1.00),
  ('pavonado',               1.15),
  ('cromado',                1.40);

-- Cobro mínimo: una pieza chica no cuesta proporcionalmente menos, porque la
-- mano de obra y el traslado no escalan con el tamaño.
CREATE TABLE public.parametros_cotizacion (
    clave  text PRIMARY KEY,
    valor  numeric(12,2) NOT NULL,
    nota   text
);

INSERT INTO public.parametros_cotizacion (clave, valor, nota) VALUES
  ('precio_minimo', 1500.00, 'Cobro mínimo por pieza. Provisional.');

-- ─── El cálculo ─────────────────────────────────────────────────────────────

-- SECURITY DEFINER a propósito: un visitante anónimo debe poder cotizar sin
-- que eso le dé permiso de leer el tarifario completo.
CREATE OR REPLACE FUNCTION public.calcular_precio(
    p_largo_mm integer,
    p_alto_mm  integer,
    p_material public.material_tipo,
    p_acabado  public.acabado_tipo
) RETURNS numeric
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
  v_area_m2 numeric;
  v_precio  numeric;
  v_minimo  numeric;
BEGIN
  IF p_largo_mm IS NULL OR p_alto_mm IS NULL
     OR p_largo_mm <= 0 OR p_alto_mm <= 0 THEN
    RETURN NULL;
  END IF;

  v_area_m2 := (p_largo_mm::numeric * p_alto_mm::numeric) / 1000000.0;

  SELECT tm.precio_m2 * ta.factor * v_area_m2
    INTO v_precio
    FROM public.tarifas_material tm, public.tarifas_acabado ta
   WHERE tm.material = p_material AND ta.acabado = p_acabado;

  IF v_precio IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT valor INTO v_minimo
    FROM public.parametros_cotizacion WHERE clave = 'precio_minimo';

  RETURN ROUND(GREATEST(v_precio, COALESCE(v_minimo, 0)), 2);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.calcular_precio(integer, integer, public.material_tipo, public.acabado_tipo) FROM public;
GRANT  EXECUTE ON FUNCTION public.calcular_precio(integer, integer, public.material_tipo, public.acabado_tipo) TO anon, authenticated;

-- ─── El precio lo pone el servidor, siempre ─────────────────────────────────

-- Sin este trigger, el formulario podría mandar precio_estimado = 1 y la base
-- lo guardaría tal cual.
CREATE OR REPLACE FUNCTION public.set_precio_estimado() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
BEGIN
  NEW.precio_estimado := public.calcular_precio(
    NEW.largo_mm, NEW.alto_mm, NEW.material, NEW.acabado);
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_set_precio_estimado
    BEFORE INSERT OR UPDATE OF largo_mm, alto_mm, material, acabado
    ON public.custom_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_precio_estimado();

-- Calcular el de las 3 solicitudes que ya existían.
UPDATE public.custom_requests SET largo_mm = largo_mm;

-- ─── RLS del tarifario ──────────────────────────────────────────────────────

-- Las tarifas son información comercial: el público cotiza a través de la
-- función, pero no ve la lista de precios.
ALTER TABLE public.tarifas_material       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarifas_acabado        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parametros_cotizacion  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tarifas_material_select_staff" ON public.tarifas_material
    FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "tarifas_material_write_admin" ON public.tarifas_material
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "tarifas_acabado_select_staff" ON public.tarifas_acabado
    FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "tarifas_acabado_write_admin" ON public.tarifas_acabado
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "parametros_select_staff" ON public.parametros_cotizacion
    FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "parametros_write_admin" ON public.parametros_cotizacion
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── Pendiente de 0002 que el linter marcó ──────────────────────────────────

-- is_staff() e is_admin() se quedaron sin search_path fijo.
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = public
    AS $$ SELECT public.current_user_role() IN ('vendedor', 'admin'); $$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = public
    AS $$ SELECT public.current_user_role() = 'admin'; $$;

CREATE OR REPLACE FUNCTION public.generate_employee_username() RETURNS trigger
    LANGUAGE plpgsql SET search_path = public
    AS $$
BEGIN
  IF NEW.role IN ('vendedor', 'admin') THEN
    NEW.username := LOWER(NEW.first_name) || '.' || LOWER(NEW.last_name_p);
  END IF;
  RETURN NEW;
END;
$$;
