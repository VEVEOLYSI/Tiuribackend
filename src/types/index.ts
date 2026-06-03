import type { SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'customer' | 'staff' | 'admin';
export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';
export type PaymentGateway = 'paystack' | 'mpesa' | 'stripe' | 'cash';
export type TransactionStatus = 'pending' | 'success' | 'failed' | 'refunded';
export type DiscountType = 'percent' | 'fixed';
export type ReviewTarget = 'product' | 'service';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export type AppVariables = {
  user?: AuthUser;
  userClient?: SupabaseClient;
  requestId: string;
};

export type AppEnv = { Variables: AppVariables };

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
