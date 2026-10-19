-- Historical costs cannot be reconstructed from today's weighted average.
-- Existing movements intentionally have no valuation evidence.
CREATE TABLE "merchant_inventory_valuation" (
 "movement_id" uuid PRIMARY KEY REFERENCES "merchant_inventory_movement"("id"),
 "venue_id" uuid NOT NULL REFERENCES "merchant_venue"("id"),
 "data" jsonb NOT NULL
);
