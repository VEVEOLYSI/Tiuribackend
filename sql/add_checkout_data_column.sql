-- Run once in Supabase SQL Editor.
-- Allows payment_transactions to carry a cart snapshot so an order can be
-- created server-side AFTER the payment is confirmed (no pre-payment order).

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS checkout_data JSONB;
