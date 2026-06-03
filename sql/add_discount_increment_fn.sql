-- Run this in Supabase SQL Editor once to support atomic discount code usage increments
CREATE OR REPLACE FUNCTION public.increment_discount_code_usage(p_code_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.discount_codes
  SET used_count = used_count + 1
  WHERE id = p_code_id;
END;
$$;
