-- Link new physical sale issues explicitly. Do not infer historical links from free text.
ALTER TABLE merchant_inventory_valuation ADD COLUMN order_id uuid REFERENCES merchant_order(id);
CREATE INDEX merchant_inventory_valuation_order ON merchant_inventory_valuation(order_id);

CREATE INDEX merchant_inventory_movement_range ON merchant_inventory_movement(venue_id,created_at);
