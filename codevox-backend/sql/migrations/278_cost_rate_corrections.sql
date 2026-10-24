-- Published prices and the 16 Oct 2026 USD/INR rate.
-- Gemini 3.8 Flash: $0.75 / 1M input, $3.75 / 1M output (thinking included in output).
-- Qwen: free. Sarvam STT: ₹30 / hour. Sarvam TTS: ₹30 / 10,000 characters.
-- 1 USD = 94.89 INR.

UPDATE cost_fx_rates
SET rate_to_inr = 94.8900
WHERE quote_currency = 'USD' AND effective_to IS NULL;

UPDATE cost_rate_cards SET unit_price = 0.000000750000 WHERE id = 'gemini-3.8-flash-in-2026';
UPDATE cost_rate_cards SET unit_price = 0.000003750000 WHERE id = 'gemini-3.8-flash-out-2026';
UPDATE cost_rate_cards SET unit_price = 0.008333333333 WHERE id = 'saaras-v3-2026';
UPDATE cost_rate_cards SET unit_price = 0.003000000000 WHERE id = 'bulbul-v3-2026';

INSERT INTO cost_rate_cards (id, provider, service_type, model_or_resource, unit, vendor_currency, unit_price, effective_from)
SELECT * FROM (
  SELECT 'qwen-free-in-2026' AS id, 'groq' AS provider, 'llm_input' AS service_type, 'qwen' AS model_or_resource, 'tokens' AS unit, 'INR' AS vendor_currency, 0.000000000000 AS unit_price, '2026-01-01 00:00:00' AS effective_from
  UNION ALL SELECT 'qwen-free-out-2026', 'groq', 'llm_output', 'qwen', 'tokens', 'INR', 0.000000000000, '2026-01-01 00:00:00'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM cost_rate_cards c WHERE c.id = seed.id);

UPDATE assessment_usage_ledger l
JOIN cost_rate_cards c ON c.id = l.rate_card_id
SET
  l.snapshot_unit_price = c.unit_price,
  l.snapshot_cost_vendor_currency = ROUND(l.quantity_units * c.unit_price, 4),
  l.fx_rate_to_inr = IF(c.vendor_currency = 'INR', 1, 94.8900),
  l.snapshot_cost_inr = IF(
    c.vendor_currency = 'INR',
    ROUND(l.quantity_units * c.unit_price, 4),
    ROUND(l.quantity_units * c.unit_price * 94.8900, 4)
  );

UPDATE assessment_usage_ledger
SET
  rate_card_id = IF(service_type = 'llm_input', 'qwen-free-in-2026', 'qwen-free-out-2026'),
  vendor_currency = 'INR',
  snapshot_unit_price = 0,
  snapshot_cost_vendor_currency = 0,
  fx_rate_to_inr = 1,
  snapshot_cost_inr = 0
WHERE snapshot_cost_inr IS NULL
  AND resource_name LIKE '%qwen%';
