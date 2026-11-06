-- Migration: move Returns from browser localStorage into Supabase.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: useReturnStore previously persisted to localStorage only (zustand
-- `persist`), unlike Refunds which is fully Supabase-backed. "Approved"
-- returns vanished on a different machine or cleared browser storage, and
-- weren't covered by the Activity Log or RLS at all. This table mirrors
-- `refunds` so Returns gets the same durability and audit trail.

CREATE TABLE returns (
  return_id      SERIAL PRIMARY KEY,
  transaction_id INTEGER REFERENCES transactions(transaction_id) ON DELETE SET NULL,
  customer_name  VARCHAR(100) DEFAULT 'Walk-in',
  reason         VARCHAR(150),
  method         VARCHAR(30),
  notes          TEXT,
  subtotal       NUMERIC(10,2) DEFAULT 0,
  vat            NUMERIC(10,2) DEFAULT 0,
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  status         VARCHAR(20)  NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  processed_by   VARCHAR(100),
  items          JSONB,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON returns FOR SELECT TO authenticated USING (true);

-- Any signed-in user (cashier or admin) can submit a return request.
CREATE POLICY "Allow authenticated insert" ON returns FOR INSERT TO authenticated WITH CHECK (true);

-- Only an admin can approve/reject one (same restriction as refunds —
-- see fix_role_based_rls.sql).
CREATE POLICY "Admins can update returns" ON returns FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE INDEX idx_returns_transaction ON returns(transaction_id);
CREATE INDEX idx_returns_status      ON returns(status);
