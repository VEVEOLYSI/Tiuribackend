-- Run this once in Supabase SQL Editor before starting the server.
-- Adds 'paystack' to the payment_gateway enum so transactions can be recorded.

ALTER TYPE public.payment_gateway ADD VALUE IF NOT EXISTS 'paystack';
