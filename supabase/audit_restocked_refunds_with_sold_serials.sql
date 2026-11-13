-- Read-only audit — NOT a migration, changes nothing. Run in Supabase
-- Dashboard -> SQL Editor to review existing data before/after the
-- refund/return redesign.
--
-- What it finds: every APPROVED refund (under the old item-based design)
-- whose line items reference a serialized (has_serial) product. The old
-- handleApprove() called restockProduct() for these — bumping
-- products.stock up by the refunded qty — but never touched
-- product_serials at all (see Q4 in the refund audit: "Serial numbers are
-- never touched"). still_sold_serials_on_this_sale lists the serials for
-- that product still marked 'Sold' under the same transaction — if that
-- array is non-empty, products.stock was very likely bumped for a unit
-- whose serial was never flipped back to 'In Stock', i.e. stock now counts
-- a unit that, serial-wise, still looks sold.
--
-- This only lists candidates for you to review by hand — it changes
-- nothing. Deciding what (if anything) to correct — bump the serial back
-- to 'In Stock', adjust stock down, or leave it — depends on whether that
-- unit is actually back on the shelf, which only you can confirm.

SELECT
  r.refund_id,
  r.transaction_id,
  r.status,
  r.processed_at,
  p.product_id,
  p.name                                                      AS product_name,
  COALESCE((ri->>'refundQty')::int, (ri->>'qty')::int, 1)     AS refunded_qty,
  p.stock                                                     AS current_stock,
  (
    SELECT array_agg(ps.serial_number)
    FROM product_serials ps
    WHERE ps.product_id = p.product_id
      AND ps.transaction_id = r.transaction_id
      AND ps.status = 'Sold'
  )                                                            AS still_sold_serials_on_this_sale
FROM refunds r
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.items, '[]'::jsonb)) AS ri
JOIN products p ON p.product_id = (ri->>'id')::int
WHERE r.status = 'Approved'
  AND p.has_serial = true
ORDER BY r.refund_id;
