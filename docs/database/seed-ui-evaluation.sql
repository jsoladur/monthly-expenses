-- ============================================================================
-- Monthly Expenses — Fake UI-evaluation seed
--
-- Invented household. Generic English names and round amounts.
-- NOT copied from any tenant dump. Safe to commit.
--
-- Coverage: every month 2018-01 … 2026-09 (105 months).
-- About 80% of months have positive potential savings
--   (income − actuals − reserved remaining). The rest overspend on purpose
--   so Stats still has deficit / warning examples.
-- Amounts are exaggerated on purpose (monthly salary roughly 10–15k EUR)
-- so README shots are obviously fake, not a real household.
-- Reserved lines exist only on the in-progress month (2026-09).
--
-- Requires exactly one app_user (+ profile_settings). Wipes catalog/money
-- tables first; never touches app_user.
-- ============================================================================

BEGIN;

TRUNCATE TABLE
  month_actual_expense,
  month_income,
  month_fixed_line,
  month,
  template,
  annual,
  category
RESTART IDENTITY;

DO $$
DECLARE
  v_user_id uuid;
  v_month_id uuid;
  v_year int;
  v_month int;
  v_last_month int;
  v_income numeric(14,2);
  v_target_actuals numeric(14,2);
  v_factor numeric;
  v_overspend boolean;
  v_n int;
  v_i int;
  v_cat int;
  v_base numeric(14,2);
  v_amt numeric(14,2);
  v_sum numeric(14,2);
  v_name text;
  v_note text;
  v_positive int := 0;
  v_negative int := 0;
  v_months int := 0;

  v_exp uuid[] := ARRAY[]::uuid[];
  v_inc uuid[] := ARRAY[]::uuid[];
  v_id uuid;

  v_exp_names text[] := ARRAY[
    'Groceries', 'Housing', 'Transport', 'Utilities', 'Health',
    'Leisure', 'Clothing', 'Education', 'Household', 'Other'
  ];
  v_inc_names text[] := ARRAY['Salary', 'Freelance', 'Other income'];

  v_ticket_names text[][] := ARRAY[
    ARRAY['Weekly market', 'Supermarket', 'Bakery', 'Corner shop', 'Farm stall'],
    ARRAY['Building fees', 'Small repair', 'Hardware store', 'Furniture', 'HOA extra'],
    ARRAY['Transit pass', 'Fuel', 'Parking', 'Train ticket', 'Bike service'],
    ARRAY['Electricity', 'Water', 'Internet', 'Phone plan', 'Waste fee'],
    ARRAY['Pharmacy', 'Clinic visit', 'Dentist', 'Glasses', 'Vitamins'],
    ARRAY['Cinema', 'Concert', 'Museum', 'Streaming extra', 'Day trip'],
    ARRAY['Shoes', 'Jacket', 'Kids clothes', 'Sportswear', 'Accessories'],
    ARRAY['Course fee', 'Textbooks', 'Workshop', 'School supplies', 'Online class'],
    ARRAY['Cleaning kit', 'Kitchenware', 'Bedding', 'Garden bits', 'Light bulbs'],
    ARRAY['Bank fee', 'Gift', 'Donation', 'Postage', 'Misc.']
  ];
  v_ticket_notes text[] := ARRAY[
    'Regular shop', 'Monthly stock', 'Weekend', 'Quick top-up', 'On offer'
  ];
BEGIN
  PERFORM setseed(0.42);

  SELECT id INTO v_user_id FROM app_user LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found in app_user. Sign in once, then re-run this seed.';
  END IF;

  FOREACH v_name IN ARRAY v_exp_names LOOP
    INSERT INTO category (user_id, name, kind, active)
    VALUES (v_user_id, v_name, 'expense', true)
    RETURNING id INTO v_id;
    v_exp := v_exp || v_id;
  END LOOP;

  FOREACH v_name IN ARRAY v_inc_names LOOP
    INSERT INTO category (user_id, name, kind, active)
    VALUES (v_user_id, v_name, 'income', true)
    RETURNING id INTO v_id;
    v_inc := v_inc || v_id;
  END LOOP;

  INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
    (v_user_id, v_exp[2], 'Rent', 1850.00, 'committed', true),
    (v_user_id, v_exp[4], 'Internet', 55.00, 'committed', true),
    (v_user_id, v_exp[4], 'Phone', 35.00, 'committed', true),
    (v_user_id, v_exp[2], 'Home insurance', 75.00, 'committed', true),
    (v_user_id, v_exp[5], 'Health cover', 110.00, 'committed', true),
    (v_user_id, v_exp[6], 'Streaming', 25.00, 'committed', true),
    (v_user_id, v_exp[1], 'Groceries envelope', 750.00, 'estimated', true),
    (v_user_id, v_exp[3], 'Transport envelope', 220.00, 'estimated', true),
    (v_user_id, v_exp[6], 'Leisure envelope', 180.00, 'estimated', true),
    (v_user_id, v_exp[9], 'Household envelope', 120.00, 'estimated', true);

  INSERT INTO annual (
    user_id, category_id, name, observations, amount, charge_month, is_direct_debit, active
  ) VALUES
    (v_user_id, v_exp[2], 'Building insurance', 'Yearly building policy', 890.00, 1, true, true),
    (v_user_id, v_exp[3], 'Vehicle tax', 'Annual road tax', 280.00, 3, false, true),
    (v_user_id, v_exp[8], 'School trip', 'Optional school trip deposit', 450.00, 5, false, true),
    (v_user_id, v_exp[6], 'Summer camp', 'One week of camp', 1200.00, 7, false, true),
    (v_user_id, v_exp[2], 'Boiler service', 'Annual service', 180.00, 9, true, true),
    (v_user_id, v_exp[10], 'Year-end gifts', NULL, NULL, 12, false, true);

  FOR v_year IN 2018..2026 LOOP
    v_last_month := CASE WHEN v_year = 2026 THEN 9 ELSE 12 END;
    v_factor := 1 + (v_year - 2018) * 0.045;

    FOR v_month IN 1..v_last_month LOOP
      INSERT INTO month (user_id, year, month)
      VALUES (v_user_id, v_year, v_month)
      RETURNING id INTO v_month_id;

      -- Salary lands roughly 10–15k EUR across 2018–2026. Not a real payroll.
      v_income := round((12200 * v_factor + (v_month % 4) * 180)::numeric, 2);
      v_overspend := ((v_year * 12 + v_month) % 5 = 0);
      IF v_overspend THEN
        v_target_actuals := round((v_income * 1.12)::numeric, 2);
      ELSE
        v_target_actuals := round((v_income * (0.72 + (v_month % 5) * 0.015))::numeric, 2);
      END IF;
      -- Open month still has reserved envelopes; keep actuals lower so savings stay green.
      IF v_year = 2026 AND v_month = 9 THEN
        v_overspend := false;
        v_target_actuals := round((v_income * 0.48)::numeric, 2);
      END IF;

      INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_id, v_inc[1], 'Monthly salary', round((v_income * 0.86)::numeric, 2)),
        (v_month_id, v_inc[2], 'Side project', round((v_income * 0.14)::numeric, 2));

      v_sum := 0;
      -- Closed months record rent as an actual. The open month keeps it reserved.
      IF NOT (v_year = 2026 AND v_month = 9) THEN
        v_amt := round((1800 * v_factor)::numeric, 2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_id, v_exp[2], 'Rent', 'Monthly rent', v_amt);
        v_sum := v_amt;
      END IF;

      v_n := 36 + (v_month % 9);
      FOR v_i IN 1..v_n LOOP
        v_cat := 1 + ((v_i + v_month + v_year) % 10);
        v_base := (v_target_actuals - v_sum) / greatest(v_n - v_i + 1, 1);
        IF v_cat = 6 THEN
          v_base := v_base * (1.0 + (v_year - 2018) * 0.03);
        ELSIF v_cat = 1 THEN
          v_base := v_base * 1.1;
        END IF;
        v_amt := round((v_base * (0.55 + ((v_i * 7 + v_month) % 9) * 0.08))::numeric, 2);
        IF v_amt < 4 THEN
          v_amt := 4.00;
        END IF;
        IF v_i = v_n THEN
          v_amt := round((v_target_actuals - v_sum)::numeric, 2);
          IF v_amt < 1 THEN
            v_amt := 1.00;
          END IF;
        END IF;
        v_sum := v_sum + v_amt;
        v_name := v_ticket_names[v_cat][1 + (v_i % 5)];
        v_note := v_ticket_notes[1 + (v_i % 5)];
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_id, v_exp[v_cat], v_name, v_note, v_amt);
      END LOOP;

      IF v_year = 2026 AND v_month = 9 THEN
        INSERT INTO month_fixed_line (
          month_id, category_id, name, observations,
          remaining_amount, original_amount, kind, origin
        ) VALUES
          (v_month_id, v_exp[2], 'Rent', 'Monthly rent', 1850.00, 1850.00, 'committed', 'cloned'),
          (v_month_id, v_exp[4], 'Internet', NULL, 55.00, 55.00, 'committed', 'cloned'),
          (v_month_id, v_exp[4], 'Phone', NULL, 35.00, 35.00, 'committed', 'cloned'),
          (v_month_id, v_exp[2], 'Home insurance', NULL, 75.00, 75.00, 'committed', 'cloned'),
          (v_month_id, v_exp[5], 'Health cover', NULL, 110.00, 110.00, 'committed', 'cloned'),
          (v_month_id, v_exp[6], 'Streaming', NULL, 25.00, 25.00, 'committed', 'cloned'),
          (v_month_id, v_exp[1], 'Groceries envelope', NULL, 420.00, 750.00, 'estimated', 'cloned'),
          (v_month_id, v_exp[3], 'Transport envelope', NULL, 90.00, 220.00, 'estimated', 'cloned'),
          (v_month_id, v_exp[6], 'Leisure envelope', NULL, 80.00, 180.00, 'estimated', 'cloned'),
          (v_month_id, v_exp[9], 'Household envelope', NULL, 40.00, 120.00, 'estimated', 'cloned');
      END IF;

      v_months := v_months + 1;
    END LOOP;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE savings > 0),
    count(*) FILTER (WHERE savings < 0)
  INTO v_positive, v_negative
  FROM (
    SELECT
      coalesce((SELECT sum(amount::numeric) FROM month_income i WHERE i.month_id = m.id), 0)
      - (
        coalesce((SELECT sum(amount::numeric) FROM month_actual_expense a WHERE a.month_id = m.id), 0)
        + coalesce((SELECT sum(remaining_amount::numeric) FROM month_fixed_line l WHERE l.month_id = m.id), 0)
      ) AS savings
    FROM month m
  ) s;

  RAISE NOTICE 'Fake seed ready: % months, % positive savings, % negative (% percent positive)',
    v_months, v_positive, v_negative,
    round(100.0 * v_positive / v_months);
END $$;

COMMIT;
