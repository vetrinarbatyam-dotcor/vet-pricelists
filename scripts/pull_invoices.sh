#!/usr/bin/env bash
# Pull the Vetmarket order-confirmation lines out of the Invoices Plus database.
#
# Vetmarket publishes no price list, so its rows are built from invoices. unit_price there is
# the LIST price before discount and is what we publish; discount_pct is the clinic's own
# discount and is deliberately NOT selected. Bonus lines (discount_pct = 100) carry the same
# list price, so they are kept for coverage.
#
# Usage: bash scripts/pull_invoices.sh   ->  _canonical/invoices_plus_vetmarket.json
set -euo pipefail
HOST=${HOST:-claude-user@167.86.69.208}
OUT="$(dirname "$0")/../_canonical/invoices_plus_vetmarket.json"

SQL="SELECT json_agg(t) FROM (SELECT l.sku, l.description AS name, MAX(l.unit_price)::float AS unit_price, MAX(i.billing_month) AS month FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN suppliers s ON s.id = i.supplier_id WHERE s.name LIKE '%וטמרקט%' AND l.unit_price > 0 AND l.sku IS NOT NULL AND l.sku <> '' GROUP BY l.sku, l.description) t;"

ssh "$HOST" "docker exec -i invoices-plus-db-1 psql -U invoices -d invoices_db -t -A -c \"\$(cat)\"" <<< "$SQL" > "$OUT"
python -c "import json,sys; d=json.load(open(sys.argv[1],encoding='utf-8')); print(len(d),'rows ->',sys.argv[1])" "$OUT"
