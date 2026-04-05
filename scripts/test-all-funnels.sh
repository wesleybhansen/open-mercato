#!/bin/bash
# Test all funnel patterns — every flow path
# Checks: correct redirects, correct cart contents, correct final destination

BASE="http://localhost:3000"
DB="postgres://crm:crm_dev_2026@localhost:5432/crm"
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✅ $label"
    PASS=$((PASS+1))
  else
    echo "  ❌ $label"
    echo "     Expected: $expected"
    echo "     Got: $actual"
    FAIL=$((FAIL+1))
  fi
}

get_redirect() {
  curl -s -D- -o /dev/null "$1" 2>&1 | grep -i 'location:' | tr -d '\r' | sed 's/location: //'
}

get_session_id() {
  local url="$1"
  echo "$url" | grep -o 'funnel_sid=[^&]*' | cut -d= -f2
}

get_sid_param() {
  local url="$1"
  echo "$url" | grep -o 'sid=[^&]*' | cut -d= -f2
}

get_cart() {
  psql "$DB" -t -c "SELECT cart_items FROM funnel_sessions WHERE id = '$1'" | tr -d ' \n'
}

get_cart_total() {
  psql "$DB" -t -c "SELECT COALESCE(SUM((item->>'price')::numeric), 0) FROM funnel_sessions, jsonb_array_elements(CASE WHEN cart_items IS NULL OR cart_items::text = '[]' THEN '[]'::jsonb ELSE cart_items::jsonb END) AS item WHERE id = '$1'" | tr -d ' \n'
}

get_cart_count() {
  psql "$DB" -t -c "SELECT COALESCE(jsonb_array_length(CASE WHEN cart_items IS NULL OR cart_items::text = '[]' THEN '[]'::jsonb ELSE cart_items::jsonb END), 0) FROM funnel_sessions WHERE id = '$1'" | tr -d ' \n'
}

submit_form() {
  local slug="$1" sid="$2" step="$3" funnel_slug="$4"
  curl -s "$BASE/api/landing-pages/public/$slug/submit" \
    -X POST -H "Content-Type: application/json" \
    -d "{\"data\":{\"name\":\"Test User\",\"email\":\"test-${RANDOM}@example.com\",\"funnel_sid\":\"$sid\",\"funnel_step\":\"$step\",\"funnel_slug\":\"$funnel_slug\"}}"
}

upsell_action() {
  local funnel_slug="$1" sid="$2" step_id="$3" action="$4"
  curl -s "$BASE/api/funnels/public/$funnel_slug/upsell" \
    -X POST -H "Content-Type: application/json" \
    -d "{\"sid\":\"$sid\",\"stepId\":\"$step_id\",\"action\":\"$action\"}"
}

advance() {
  local funnel_slug="$1" sid="$2" step_id="$3"
  curl -s "$BASE/api/funnels/public/$funnel_slug/advance" \
    -X POST -H "Content-Type: application/json" \
    -d "{\"sid\":\"$sid\",\"stepId\":\"$step_id\",\"email\":\"test-${RANDOM}@example.com\",\"name\":\"Test\"}"
}

# Clean all test sessions
psql "$DB" -c "DELETE FROM funnel_visits WHERE funnel_id IN (SELECT id FROM funnels WHERE slug LIKE 'test-pattern-%')" > /dev/null 2>&1
psql "$DB" -c "DELETE FROM funnel_orders WHERE funnel_id IN (SELECT id FROM funnels WHERE slug LIKE 'test-pattern-%')" > /dev/null 2>&1
psql "$DB" -c "DELETE FROM funnel_sessions WHERE funnel_id IN (SELECT id FROM funnels WHERE slug LIKE 'test-pattern-%')" > /dev/null 2>&1

echo ""
echo "═══════════════════════════════════════════════════════"
echo "PATTERN 1: Free Lead → Upsell($49) → Downsell($9)"
echo "═══════════════════════════════════════════════════════"

# --- Test 1A: Accept upsell ---
echo ""
echo "Test 1A: Accept upsell (expect cart = \$49)"
REDIR=$(get_redirect "$BASE/api/funnels/public/test-pattern-1")
SID=$(get_session_id "$REDIR")
STEP1_ID="cbcf30ef-e839-44b4-8d3e-8bd16d01fbb2"
check "Step 1 redirects to landing page" "p1-lead" "$REDIR"

FORM_RESULT=$(submit_form "p1-lead-1775145844811" "$SID" "$STEP1_ID" "test-pattern-1")
check "Form submit returns redirect" "redirectUrl" "$FORM_RESULT"

UPSELL_RESULT=$(upsell_action "test-pattern-1" "$SID" "6cc18b87-b311-41ae-8c30-0e852d565225" "accept")
check "Upsell accept returns redirect" "redirectUrl" "$UPSELL_RESULT"
CART_COUNT=$(get_cart_count "$SID")
CART_TOTAL=$(get_cart_total "$SID")
check "Cart has 1 item" "1" "$CART_COUNT"
check "Cart total = 49" "49" "$CART_TOTAL"

# Follow redirect to checkout — should go to Stripe (or checkout page if no Stripe)
CHECKOUT_REDIR_URL=$(echo "$UPSELL_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('redirectUrl',''))")
CHECKOUT_REDIR=$(get_redirect "$CHECKOUT_REDIR_URL")
check "Checkout redirects to Stripe or checkout page" "stripe.com\|/checkout" "$CHECKOUT_REDIR"

# --- Test 1B: Decline upsell, accept downsell ---
echo ""
echo "Test 1B: Decline upsell, accept downsell (expect cart = \$9)"
REDIR=$(get_redirect "$BASE/api/funnels/public/test-pattern-1")
SID=$(get_session_id "$REDIR")
submit_form "p1-lead-1775145844811" "$SID" "$STEP1_ID" "test-pattern-1" > /dev/null

upsell_action "test-pattern-1" "$SID" "6cc18b87-b311-41ae-8c30-0e852d565225" "decline" > /dev/null
CART_COUNT=$(get_cart_count "$SID")
check "After upsell decline: cart empty" "0" "$CART_COUNT"

DOWNSELL_RESULT=$(upsell_action "test-pattern-1" "$SID" "07773bd0-663b-47b0-b399-69baedb1d5ae" "accept")
CART_COUNT=$(get_cart_count "$SID")
CART_TOTAL=$(get_cart_total "$SID")
check "After downsell accept: cart has 1 item" "1" "$CART_COUNT"
check "Cart total = 9" "9" "$CART_TOTAL"

# --- Test 1C: Decline both ---
echo ""
echo "Test 1C: Decline both (expect empty cart → thank you)"
REDIR=$(get_redirect "$BASE/api/funnels/public/test-pattern-1")
SID=$(get_session_id "$REDIR")
submit_form "p1-lead-1775145844811" "$SID" "$STEP1_ID" "test-pattern-1" > /dev/null

upsell_action "test-pattern-1" "$SID" "6cc18b87-b311-41ae-8c30-0e852d565225" "decline" > /dev/null
upsell_action "test-pattern-1" "$SID" "07773bd0-663b-47b0-b399-69baedb1d5ae" "decline" > /dev/null
CART_COUNT=$(get_cart_count "$SID")
check "After both declines: cart empty" "0" "$CART_COUNT"

# Follow redirect — checkout should skip to thank you
CHECKOUT_URL="$BASE/api/funnels/public/test-pattern-1?step=7497f791-2aad-49e3-8e47-b6e9532875b6&sid=$SID"
CHECKOUT_REDIR=$(get_redirect "$CHECKOUT_URL")
check "Empty cart skips to thank you" "f6ace2ba" "$CHECKOUT_REDIR"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "PATTERN 2: Paid Product(\$49) → Upsell(\$199)"
echo "═══════════════════════════════════════════════════════"

# --- Test 2A: Buy product, accept upsell ---
echo ""
echo "Test 2A: Buy \$49, accept upsell \$199 (expect cart = \$248)"
REDIR=$(get_redirect "$BASE/api/funnels/public/test-pattern-2")
SID=$(get_session_id "$REDIR")
STEP1_ID="f764f9c9-5889-4c1d-adc8-db62d7f83752"

# For paid product pages, the checkoutScript calls /advance which adds product to cart
ADV_RESULT=$(advance "test-pattern-2" "$SID" "$STEP1_ID")
check "Advance returns redirect to upsell" "redirectUrl" "$ADV_RESULT"
CART_COUNT=$(get_cart_count "$SID")
CART_TOTAL=$(get_cart_total "$SID")
check "After step 1: cart has 1 item (\$49)" "1" "$CART_COUNT"
check "Cart total = 49" "49" "$CART_TOTAL"

UPSELL_RESULT=$(upsell_action "test-pattern-2" "$SID" "7e6b778e-9950-4eec-9634-62bbfa03c46e" "accept")
CART_COUNT=$(get_cart_count "$SID")
CART_TOTAL=$(get_cart_total "$SID")
check "After upsell accept: cart has 2 items" "2" "$CART_COUNT"
check "Cart total = 248" "248" "$CART_TOTAL"

# --- Test 2B: Buy product, decline upsell ---
echo ""
echo "Test 2B: Buy \$49, decline upsell (expect cart = \$49)"
REDIR=$(get_redirect "$BASE/api/funnels/public/test-pattern-2")
SID=$(get_session_id "$REDIR")
advance "test-pattern-2" "$SID" "$STEP1_ID" > /dev/null

upsell_action "test-pattern-2" "$SID" "7e6b778e-9950-4eec-9634-62bbfa03c46e" "decline" > /dev/null
CART_COUNT=$(get_cart_count "$SID")
CART_TOTAL=$(get_cart_total "$SID")
check "After upsell decline: cart has 1 item" "1" "$CART_COUNT"
check "Cart total = 49" "49" "$CART_TOTAL"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "PATTERN 3: Simple Paid Product(\$19) — No Upsell"
echo "═══════════════════════════════════════════════════════"

echo ""
echo "Test 3A: Buy \$19 product (expect cart = \$19)"
REDIR=$(get_redirect "$BASE/api/funnels/public/test-pattern-3")
SID=$(get_session_id "$REDIR")
STEP1_ID="a62874b3-1b3b-49ba-be1f-3f5fb3bb48cb"

advance "test-pattern-3" "$SID" "$STEP1_ID" > /dev/null
CART_COUNT=$(get_cart_count "$SID")
CART_TOTAL=$(get_cart_total "$SID")
check "Cart has 1 item (\$19)" "1" "$CART_COUNT"
check "Cart total = 19" "19" "$CART_TOTAL"

# Checkout should go to Stripe (not skip, because cart has items)
CHECKOUT_URL="$BASE/api/funnels/public/test-pattern-3?step=677a43f1-cde5-4e6a-9a30-fe4fa548f41e&sid=$SID"
CHECKOUT_REDIR=$(get_redirect "$CHECKOUT_URL")
check "Checkout goes to Stripe or checkout page (not thank you)" "stripe.com\|/checkout" "$CHECKOUT_REDIR"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "PATTERN 4: Free Lead Only — No Purchase"
echo "═══════════════════════════════════════════════════════"

echo ""
echo "Test 4A: Submit lead form (expect → thank you)"
REDIR=$(get_redirect "$BASE/api/funnels/public/test-pattern-4")
SID=$(get_session_id "$REDIR")
STEP1_ID="3eb29884-b036-4824-97f8-78f61cf527b3"

FORM_RESULT=$(submit_form "p4-lead-1775145844851" "$SID" "$STEP1_ID" "test-pattern-4")
check "Form submit returns redirect to thank you" "ca62ddbe" "$FORM_RESULT"

# Verify thank you page renders
THANKYOU_URL=$(echo "$FORM_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('redirectUrl',''))")
THANKYOU_HTML=$(curl -s "$THANKYOU_URL")
check "Thank you page says 'signing up' not 'purchase'" "signing up" "$THANKYOU_HTML"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "RESULTS: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi
