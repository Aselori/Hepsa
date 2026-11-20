ALTER TABLE public.custom_requests
  ADD COLUMN quote_expires_at timestamptz,
  ADD COLUMN converted_order_id bigint UNIQUE REFERENCES public.orders(id);

-- Dar dos semanas a las cotizaciones que estaban pendientes de atención.
UPDATE public.custom_requests
SET quote_expires_at = now() + interval '336 hours'
WHERE status IS NULL OR status IN ('Pendiente de Revisión', 'Contactado');

CREATE FUNCTION public.fijar_vigencia_cotizacion() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.quote_expires_at := now() + interval '336 hours';
  NEW.converted_order_id := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fijar_vigencia_cotizacion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tr_fijar_vigencia_cotizacion
  BEFORE INSERT ON public.custom_requests
  FOR EACH ROW EXECUTE FUNCTION public.fijar_vigencia_cotizacion();

REVOKE UPDATE ON public.custom_requests FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status) ON public.custom_requests TO authenticated;

CREATE FUNCTION public.renovar_cotizacion(p_solicitud uuid)
RETURNS TABLE (quote_expires_at timestamptz, precio_estimado numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  solicitud public.custom_requests%ROWTYPE;
BEGIN
  IF public.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal de ventas puede renovar cotizaciones';
  END IF;

  SELECT * INTO solicitud FROM public.custom_requests WHERE id = p_solicitud FOR UPDATE;
  IF NOT FOUND OR solicitud.converted_order_id IS NOT NULL OR solicitud.status = 'Finalizado' THEN
    RAISE EXCEPTION 'Esta solicitud no se puede renovar';
  END IF;

  RETURN QUERY
    UPDATE public.custom_requests AS s
    SET quote_expires_at = clock_timestamp() + interval '336 hours',
        precio_estimado = public.calcular_precio(s.largo_mm, s.alto_mm, s.material, s.acabado)
    WHERE s.id = p_solicitud
    RETURNING s.quote_expires_at, s.precio_estimado;
END;
$$;

CREATE FUNCTION public.convertir_solicitud_en_venta(
  p_solicitud uuid, p_cliente jsonb, p_conceptos jsonb,
  p_pago public.payment_status, p_notas text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  solicitud public.custom_requests%ROWTYPE;
  folio bigint;
BEGIN
  IF public.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal de ventas puede convertir cotizaciones';
  END IF;

  SELECT * INTO solicitud FROM public.custom_requests WHERE id = p_solicitud FOR UPDATE;
  IF NOT FOUND OR solicitud.status = 'Finalizado' THEN
    RAISE EXCEPTION 'Esta solicitud no se puede convertir';
  END IF;
  IF solicitud.converted_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta solicitud ya se convirtió en la venta #%', solicitud.converted_order_id;
  END IF;
  IF solicitud.quote_expires_at IS NULL OR solicitud.quote_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Actualiza la cotización antes de convertirla en venta';
  END IF;

  folio := public.registrar_venta(p_cliente, p_conceptos, p_pago, p_notas);
  UPDATE public.custom_requests
  SET converted_order_id = folio, status = 'En Progreso'
  WHERE id = p_solicitud;
  RETURN folio;
END;
$$;

REVOKE ALL ON FUNCTION public.renovar_cotizacion(uuid),
  public.convertir_solicitud_en_venta(uuid, jsonb, jsonb, public.payment_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renovar_cotizacion(uuid),
  public.convertir_solicitud_en_venta(uuid, jsonb, jsonb, public.payment_status, text) TO authenticated;
