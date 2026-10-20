ALTER TABLE merchant_order ADD COLUMN payment_method text;
ALTER TABLE merchant_order ADD COLUMN cash_receipt_id uuid;
CREATE TABLE merchant_cash_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES merchant_order(id),
 venue_id uuid NOT NULL REFERENCES merchant_venue(id),
 shift_id uuid NOT NULL REFERENCES merchant_shift(id),
 employee_id uuid NOT NULL REFERENCES merchant_employee(id),
 currency text NOT NULL CHECK (currency IN ('EUR','PLN','USD')),
 due_minor integer NOT NULL, tendered_minor integer NOT NULL, change_minor integer NOT NULL,
 order_revision integer NOT NULL, paid_snapshot jsonb NOT NULL,
 request_key text NOT NULL, request_hash text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT merchant_cash_receipt_amounts CHECK (due_minor>=0 AND tendered_minor>=due_minor AND change_minor=tendered_minor-due_minor)
);
ALTER TABLE merchant_order ADD CONSTRAINT merchant_order_cash_receipt_fk FOREIGN KEY (cash_receipt_id) REFERENCES merchant_cash_receipt(id);
CREATE INDEX merchant_cash_receipt_range ON merchant_cash_receipt(venue_id,recorded_at);
