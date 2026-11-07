-- ============================================================================
-- ROL TALLER: quien fabrica e instala.
--
-- Va sola porque Postgres no deja usar un valor nuevo de un enum en la misma
-- transacción que lo agrega; las políticas que lo usan están en la migración
-- siguiente (20261107000002_permisos_por_rol.sql).
-- ============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'taller';
