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

// ─── ERP types ────────────────────────────────────────────────────────────────

export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'maternity' | 'paternity';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type SalaryType = 'fixed' | 'commission' | 'hybrid';
export type InventoryTxnType = 'stock_in' | 'stock_out' | 'adjustment' | 'wastage' | 'return';
export type AssetStatus = 'active' | 'maintenance' | 'retired' | 'disposed';
export type PayrollStatus = 'draft' | 'approved' | 'paid';
export type CommissionStatus = 'pending' | 'paid';
export type POStatus = 'draft' | 'sent' | 'received' | 'cancelled';

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
