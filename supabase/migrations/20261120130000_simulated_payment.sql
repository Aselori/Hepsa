-- Pago en línea simulado, para el sitio publicado sin cuenta de Stripe.
--
-- El cliente confirma el pago de SU pedido pendiente en un diálogo de
-- demostración y el pago queda registrado igual que uno de Stripe: fila en
-- payments (provider = 'simulado'), pedido marcado como pagado y existencias
-- descontadas, todo por record_online_payment. No mueve dinero. Cuando HEPSA
-- active Stripe se apaga pagosSimulados en config.js y esta función deja de
-- usarse.

CREATE FUNCTION public.simulate_online_payment(p_order_id bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_session text := 'sim_' || gen_random_uuid()::text;
  v_result  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para pagar';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND client_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos ese pedido en tu cuenta';
  END IF;
  IF v_order.payment_status <> 'pending' THEN
    RAISE EXCEPTION 'Este pedido no tiene un pago pendiente';
  END IF;

  v_result := public.record_online_payment(p_order_id, v_session, v_order.total, 'mxn');
  UPDATE public.payments SET provider = 'simulado' WHERE session_id = v_session;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.simulate_online_payment(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_online_payment(bigint) TO authenticated;
