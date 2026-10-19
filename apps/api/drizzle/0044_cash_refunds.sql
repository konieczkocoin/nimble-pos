CREATE TABLE merchant_cash_refund (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES merchant_order(id),
 receipt_id uuid NOT NULL UNIQUE REFERENCES merchant_cash_receipt(id), venue_id uuid NOT NULL REFERENCES merchant_venue(id),
 status text NOT NULL DEFAULT 'REQUESTED', reason text NOT NULL, original_status text NOT NULL,
 requested_by_kind text NOT NULL, requested_by_id uuid NOT NULL, requested_by_name text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(), confirmed_by_owner_id uuid REFERENCES user_profile(id), confirmed_at timestamptz,
 amount_minor integer NOT NULL, currency text NOT NULL, payout_shift_id uuid REFERENCES merchant_shift(id),
 CONSTRAINT merchant_cash_refund_state CHECK ((status='REQUESTED' AND confirmed_at IS NULL AND confirmed_by_owner_id IS NULL) OR (status='CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by_owner_id IS NOT NULL)),
 CONSTRAINT merchant_cash_refund_values CHECK (amount_minor>=0 AND currency IN ('EUR','PLN','USD') AND length(reason) BETWEEN 1 AND 500 AND original_status IN ('PREPARING','READY','COLLECTED') AND requested_by_kind IN ('owner','cashier') AND payout_shift_id IS NULL)
);
CREATE INDEX merchant_cash_refund_range ON merchant_cash_refund(venue_id,confirmed_at);
