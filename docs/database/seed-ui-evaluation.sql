-- ============================================================================
-- Monthly Expenses — Seed script for UI/UX evaluation
-- One-off execution: populates the app with fake data for demonstration
-- Target: PostgreSQL 16 · Assumes exactly ONE row exists in app_user
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Get the only user in the system
-- ============================================================================
DO $$
DECLARE
    v_user_id uuid;
    v_month_id uuid;
    v_category_id uuid;
    v_template_id uuid;
    v_actual_id uuid;
    v_fixed_line_id uuid;
    v_income_id uuid;
    
    -- Category IDs (expense)
    v_cat_groceries uuid;
    v_cat_transport uuid;
    v_cat_restaurants uuid;
    v_cat_entertainment uuid;
    v_cat_health uuid;
    v_cat_education uuid;
    v_cat_clothing uuid;
    v_cat_home uuid;
    v_cat_utilities uuid;
    v_cat_personal uuid;
    
    -- Category IDs (income)
    v_cat_salary uuid;
    v_cat_freelance uuid;
    v_cat_investments uuid;
    v_cat_rental uuid;
    v_cat_bonuses uuid;
    v_cat_dividends uuid;
    v_cat_interest uuid;
    v_cat_side_business uuid;
    v_cat_gifts uuid;
    v_cat_refunds uuid;
    
    -- Template IDs
    v_tmpl_rent uuid;
    v_tmpl_mortgage uuid;
    v_tmpl_internet uuid;
    v_tmpl_phone uuid;
    v_tmpl_electricity uuid;
    v_tmpl_water uuid;
    v_tmpl_gas uuid;
    v_tmpl_insurance uuid;
    v_tmpl_gym uuid;
    v_tmpl_streaming uuid;
    v_tmpl_groceries_budget uuid;
    v_tmpl_transport_budget uuid;
    v_tmpl_restaurants_budget uuid;
    v_tmpl_entertainment_budget uuid;
    v_tmpl_health_budget uuid;
    v_tmpl_education_budget uuid;
    v_tmpl_clothing_budget uuid;
    v_tmpl_home_maintenance uuid;
    v_tmpl_personal_care uuid;
    v_tmpl_miscellaneous uuid;
    
    -- Month IDs for 2026
    v_month_jan_2026 uuid;
    v_month_feb_2026 uuid;
    v_month_mar_2026 uuid;
    v_month_apr_2026 uuid;
    v_month_may_2026 uuid;
    v_month_jun_2026 uuid;
    v_month_jul_2026 uuid;
    
    -- Counters for loops
    i int;
    j int;
    v_amount numeric(14,2);
    v_names text[];
    v_observations text[];
BEGIN
    -- Get the only user
    SELECT id INTO v_user_id FROM app_user LIMIT 1;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No user found in app_user table. Please ensure exactly one user exists.';
    END IF;
    
    RAISE NOTICE 'Using user_id: %', v_user_id;
    
    -- ============================================================================
    -- 1. Create 10 Expense Categories
    -- ============================================================================
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Groceries', 'expense', true) RETURNING id INTO v_cat_groceries;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Transportation', 'expense', true) RETURNING id INTO v_cat_transport;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Restaurants', 'expense', true) RETURNING id INTO v_cat_restaurants;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Entertainment', 'expense', true) RETURNING id INTO v_cat_entertainment;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Health', 'expense', true) RETURNING id INTO v_cat_health;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Education', 'expense', true) RETURNING id INTO v_cat_education;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Clothing', 'expense', true) RETURNING id INTO v_cat_clothing;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Home', 'expense', true) RETURNING id INTO v_cat_home;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Utilities', 'expense', true) RETURNING id INTO v_cat_utilities;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Personal Care', 'expense', true) RETURNING id INTO v_cat_personal;
    
    -- ============================================================================
    -- 2. Create 10 Income Categories
    -- ============================================================================
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Salary', 'income', true) RETURNING id INTO v_cat_salary;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Freelance', 'income', true) RETURNING id INTO v_cat_freelance;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Investments', 'income', true) RETURNING id INTO v_cat_investments;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Rental Income', 'income', true) RETURNING id INTO v_cat_rental;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Bonuses', 'income', true) RETURNING id INTO v_cat_bonuses;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Dividends', 'income', true) RETURNING id INTO v_cat_dividends;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Interest', 'income', true) RETURNING id INTO v_cat_interest;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Side Business', 'income', true) RETURNING id INTO v_cat_side_business;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Gifts', 'income', true) RETURNING id INTO v_cat_gifts;
    INSERT INTO category (user_id, name, kind, active) VALUES
        (v_user_id, 'Refunds', 'income', true) RETURNING id INTO v_cat_refunds;
    
    -- ============================================================================
    -- 3. Create 10 Committed Templates
    -- ============================================================================
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_home, 'Rent', 1200.00, 'committed', true) RETURNING id INTO v_tmpl_rent;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_home, 'Mortgage', 850.00, 'committed', true) RETURNING id INTO v_tmpl_mortgage;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_utilities, 'Internet', 45.00, 'committed', true) RETURNING id INTO v_tmpl_internet;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_utilities, 'Phone', 35.00, 'committed', true) RETURNING id INTO v_tmpl_phone;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_utilities, 'Electricity', 80.00, 'committed', true) RETURNING id INTO v_tmpl_electricity;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_utilities, 'Water', 30.00, 'committed', true) RETURNING id INTO v_tmpl_water;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_utilities, 'Gas', 50.00, 'committed', true) RETURNING id INTO v_tmpl_gas;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_home, 'Insurance', 120.00, 'committed', true) RETURNING id INTO v_tmpl_insurance;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_personal, 'Gym', 40.00, 'committed', true) RETURNING id INTO v_tmpl_gym;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_entertainment, 'Streaming Services', 25.00, 'committed', true) RETURNING id INTO v_tmpl_streaming;
    
    -- ============================================================================
    -- 4. Create 10 Estimated Templates
    -- ============================================================================
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_groceries, 'Groceries Budget', 400.00, 'estimated', true) RETURNING id INTO v_tmpl_groceries_budget;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_transport, 'Transportation Budget', 150.00, 'estimated', true) RETURNING id INTO v_tmpl_transport_budget;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_restaurants, 'Restaurants Budget', 200.00, 'estimated', true) RETURNING id INTO v_tmpl_restaurants_budget;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_entertainment, 'Entertainment Budget', 100.00, 'estimated', true) RETURNING id INTO v_tmpl_entertainment_budget;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_health, 'Health Budget', 80.00, 'estimated', true) RETURNING id INTO v_tmpl_health_budget;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_education, 'Education Budget', 60.00, 'estimated', true) RETURNING id INTO v_tmpl_education_budget;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_clothing, 'Clothing Budget', 100.00, 'estimated', true) RETURNING id INTO v_tmpl_clothing_budget;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_home, 'Home Maintenance', 75.00, 'estimated', true) RETURNING id INTO v_tmpl_home_maintenance;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_personal, 'Personal Care', 50.00, 'estimated', true) RETURNING id INTO v_tmpl_personal_care;
    INSERT INTO template (user_id, category_id, name, amount, kind, active) VALUES
        (v_user_id, v_cat_groceries, 'Miscellaneous', 100.00, 'estimated', true) RETURNING id INTO v_tmpl_miscellaneous;
    
    -- ============================================================================
    -- 5. Create all months from January to July 2026
    -- ============================================================================
    INSERT INTO month (user_id, year, month) VALUES
        (v_user_id, 2026, 1) RETURNING id INTO v_month_jan_2026;
    INSERT INTO month (user_id, year, month) VALUES
        (v_user_id, 2026, 2) RETURNING id INTO v_month_feb_2026;
    INSERT INTO month (user_id, year, month) VALUES
        (v_user_id, 2026, 3) RETURNING id INTO v_month_mar_2026;
    INSERT INTO month (user_id, year, month) VALUES
        (v_user_id, 2026, 4) RETURNING id INTO v_month_apr_2026;
    INSERT INTO month (user_id, year, month) VALUES
        (v_user_id, 2026, 5) RETURNING id INTO v_month_may_2026;
    INSERT INTO month (user_id, year, month) VALUES
        (v_user_id, 2026, 6) RETURNING id INTO v_month_jun_2026;
    INSERT INTO month (user_id, year, month) VALUES
        (v_user_id, 2026, 7) RETURNING id INTO v_month_jul_2026;
    
    -- ============================================================================
    -- 6. Create all months for 2020-2025 (72 months total)
    -- ============================================================================
    FOR i IN 2020..2025 LOOP
        FOR j IN 1..12 LOOP
            INSERT INTO month (user_id, year, month) VALUES (v_user_id, i, j);
        END LOOP;
    END LOOP;
    
    -- ============================================================================
    -- 7. July 2026: Clone templates to month_fixed_line (20 rows)
    -- ============================================================================
    
    -- Clone committed templates
    INSERT INTO month_fixed_line (month_id, category_id, name, observations, remaining_amount, original_amount, kind, origin)
    VALUES
        (v_month_jul_2026, v_cat_home, 'Rent', 'Monthly rent payment', 1200.00, 1200.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_home, 'Mortgage', 'Monthly mortgage payment', 850.00, 850.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_utilities, 'Internet', 'Monthly internet bill', 45.00, 45.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_utilities, 'Phone', 'Monthly phone bill', 35.00, 35.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_utilities, 'Electricity', 'Monthly electricity bill', 80.00, 80.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_utilities, 'Water', 'Monthly water bill', 30.00, 30.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_utilities, 'Gas', 'Monthly gas bill', 50.00, 50.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_home, 'Insurance', 'Monthly insurance premium', 120.00, 120.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_personal, 'Gym', 'Monthly gym membership', 40.00, 40.00, 'committed', 'cloned'),
        (v_month_jul_2026, v_cat_entertainment, 'Streaming Services', 'Netflix, Spotify, etc.', 25.00, 25.00, 'committed', 'cloned');
    
    -- Clone estimated templates
    INSERT INTO month_fixed_line (month_id, category_id, name, observations, remaining_amount, original_amount, kind, origin)
    VALUES
        (v_month_jul_2026, v_cat_groceries, 'Groceries Budget', 'Monthly groceries budget', 400.00, 400.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_transport, 'Transportation Budget', 'Monthly transport budget', 150.00, 150.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_restaurants, 'Restaurants Budget', 'Monthly dining out budget', 200.00, 200.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_entertainment, 'Entertainment Budget', 'Monthly entertainment budget', 100.00, 100.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_health, 'Health Budget', 'Monthly health budget', 80.00, 80.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_education, 'Education Budget', 'Monthly education budget', 60.00, 60.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_clothing, 'Clothing Budget', 'Monthly clothing budget', 100.00, 100.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_home, 'Home Maintenance', 'Monthly home maintenance budget', 75.00, 75.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_personal, 'Personal Care', 'Monthly personal care budget', 50.00, 50.00, 'estimated', 'cloned'),
        (v_month_jul_2026, v_cat_groceries, 'Miscellaneous', 'Monthly miscellaneous budget', 100.00, 100.00, 'estimated', 'cloned');
    
    -- ============================================================================
    -- 8. July 2026: Create 200 actual expense records
    -- ============================================================================
    
    -- Groceries (20 records)
    v_names := ARRAY['Supermarket', 'Fresh Market', 'Organic Store', 'Local Farm', 'Bulk Store', 
                     'Corner Shop', 'Food Market', 'Grocery Outlet', 'Discount Market', 'Premium Foods',
                     'Weekly Shopping', 'Monthly Stock', 'Fresh Produce', 'Dairy Products', 'Meat & Fish',
                     'Fruits & Vegetables', 'Bread & Bakery', 'Snacks', 'Beverages', 'Frozen Foods'];
    v_observations := ARRAY['Weekly groceries', 'Monthly bulk buy', 'Fresh produce', 'Organic items', 
                            'Discount items', 'Special occasion', 'Party supplies', 'Holiday shopping',
                            'Emergency purchase', 'Regular shopping', 'Seasonal items', 'Local produce',
                            'Imported goods', 'Dietary specific', 'Quick top-up', 'Weekend shopping',
                            'Midweek top-up', 'Special offers', 'New products', 'Favorite brands'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 80 + 10)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_groceries, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Transportation (20 records)
    v_names := ARRAY['Metro Pass', 'Bus Ticket', 'Taxi Ride', 'Uber Trip', 'Gas Station',
                     'Parking Fee', 'Toll Road', 'Car Wash', 'Car Maintenance', 'Bike Repair',
                     'Train Ticket', 'Flight Booking', 'Car Rental', 'Insurance Payment', 'Vehicle Tax',
                     'Tire Replacement', 'Oil Change', 'Public Transport', 'Ride Share', 'Emergency Taxi'];
    v_observations := ARRAY['Monthly pass', 'Daily commute', 'Night out', 'Airport transfer', 'Weekly fuel',
                            'City center', 'Highway toll', 'Monthly wash', 'Annual service', 'Puncture fix',
                            'Intercity travel', 'Vacation flight', 'Weekend trip', 'Quarterly premium', 'Annual tax',
                            'New tires', 'Regular maintenance', 'Weekly ticket', 'Shared ride', 'Late night'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 60 + 5)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_transport, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Restaurants (20 records)
    v_names := ARRAY['Italian Restaurant', 'Sushi Bar', 'Burger Joint', 'Pizza Place', 'Thai Cuisine',
                     'Mexican Grill', 'Chinese Takeaway', 'Indian Curry', 'French Bistro', 'Spanish Tapas',
                     'Coffee Shop', 'Brunch Cafe', 'Ice Cream Parlor', 'Bakery', 'Fast Food',
                     'Fine Dining', 'Family Restaurant', 'Food Court', 'Street Food', 'Buffet'];
    v_observations := ARRAY['Date night', 'Birthday celebration', 'Quick lunch', 'Weekend dinner', 'Takeaway order',
                            'Group dinner', 'Business lunch', 'Anniversary', 'Special occasion', 'Tourist area',
                            'Morning coffee', 'Weekend brunch', 'Summer treat', 'Fresh bread', 'Quick meal',
                            'Anniversary dinner', 'Kids meal', 'Mall visit', 'Quick snack', 'All-you-can-eat'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 50 + 15)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_restaurants, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Entertainment (20 records)
    v_names := ARRAY['Movie Theater', 'Concert Tickets', 'Museum Entry', 'Theater Show', 'Amusement Park',
                     'Bowling Alley', 'Escape Room', 'Karaoke Bar', 'Comedy Club', 'Art Gallery',
                     'Video Games', 'Book Purchase', 'Music Subscription', 'Streaming Service', 'Gym Class',
                     'Yoga Session', 'Dance Class', 'Sports Event', 'Festival Ticket', 'Workshop'];
    v_observations := ARRAY['Weekend movie', 'Favorite band', 'Cultural visit', 'Broadway show', 'Family day out',
                            'Friends night', 'Team building', 'Party night', 'Stand-up show', 'Exhibition visit',
                            'New release', 'Bestseller', 'Monthly subscription', 'Annual plan', 'Special class',
                            'Weekly practice', 'Social dance', 'Local team', 'Summer festival', 'Skill building'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 40 + 10)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_entertainment, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Health (20 records)
    v_names := ARRAY['Pharmacy', 'Doctor Visit', 'Dentist Appointment', 'Eye Exam', 'Physiotherapy',
                     'Vitamins', 'First Aid Supplies', 'Health Insurance', 'Gym Membership', 'Personal Trainer',
                     'Massage Therapy', 'Chiropractor', 'Mental Health', 'Blood Test', 'X-Ray',
                     'Prescription Medicine', 'Over-the-Counter', 'Health Supplements', 'Fitness Equipment', 'Wellness App'];
    v_observations := ARRAY['Monthly refill', 'Annual checkup', 'Routine cleaning', 'Vision test', 'Back pain treatment',
                            'Daily vitamins', 'Home kit', 'Monthly premium', 'Monthly fee', 'Session fee',
                            'Relaxation session', 'Spine adjustment', 'Therapy session', 'Lab work', 'Imaging',
                            'Monthly prescription', 'Cold & flu', 'Protein powder', 'Home gym', 'Subscription'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 70 + 20)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_health, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Education (20 records)
    v_names := ARRAY['Online Course', 'Textbook', 'Workshop Fee', 'Certification Exam', 'Tutoring Session',
                     'Language Class', 'Music Lesson', 'Art Class', 'Coding Bootcamp', 'Professional Development',
                     'Conference Ticket', 'Membership Fee', 'Software License', 'Study Materials', 'Lab Fee',
                     'Library Fine', 'School Supplies', 'Educational App', 'Research Paper', 'Seminar'];
    v_observations := ARRAY['Udemy course', 'Required reading', 'Weekend workshop', 'Professional cert', 'Weekly tutoring',
                            'Spanish class', 'Piano lesson', 'Painting class', 'Web development', 'Leadership training',
                            'Industry event', 'Professional body', 'Annual license', 'Semester books', 'Chemistry lab',
                            'Overdue book', 'New semester', 'Language learning', 'Journal access', 'Full day event'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 50 + 15)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_education, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Clothing (20 records)
    v_names := ARRAY['T-Shirt', 'Jeans', 'Dress Shirt', 'Sneakers', 'Jacket',
                     'Socks Pack', 'Underwear', 'Sweater', 'Coat', 'Shorts',
                     'Formal Shoes', 'Boots', 'Hat', 'Scarf', 'Gloves',
                     'Swimwear', 'Sportswear', 'Pajamas', 'Belt', 'Tie'];
    v_observations := ARRAY['Casual wear', 'Everyday jeans', 'Work attire', 'Running shoes', 'Winter jacket',
                            'Monthly supply', 'Monthly supply', 'Autumn wear', 'Heavy winter', 'Summer wear',
                            'Office wear', 'Winter boots', 'Sun protection', 'Winter accessory', 'Winter accessory',
                            'Beach vacation', 'Gym wear', 'Sleepwear', 'Formal accessory', 'Formal accessory'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 60 + 20)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_clothing, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Home (20 records)
    v_names := ARRAY['Furniture', 'Kitchen Appliances', 'Bedding', 'Towels', 'Cookware',
                     'Cleaning Supplies', 'Home Decor', 'Lighting', 'Storage Solutions', 'Garden Tools',
                     'Tools', 'Paint', 'Curtains', 'Rugs', 'Mirrors',
                     'Shelving', 'Organization', 'Safety Equipment', 'Moving Supplies', 'Repairs'];
    v_observations := ARRAY['New sofa', 'Blender purchase', 'New sheets', 'Bath towels', 'New pans',
                            'Monthly cleaning', 'Wall art', 'New lamp', 'Closet organizer', 'Lawn mower',
                            'Drill set', 'Room refresh', 'Window treatment', 'Living room rug', 'Hallway mirror',
                            'Bookshelf', 'Drawer dividers', 'Fire extinguisher', 'Box set', 'Plumber visit'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 80 + 25)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_home, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Utilities (20 records)
    v_names := ARRAY['Electricity Bill', 'Water Bill', 'Gas Bill', 'Internet Bill', 'Phone Bill',
                     'Waste Collection', 'Sewage', 'Home Insurance', 'Content Insurance', 'Security System',
                     'Landline Phone', 'Mobile Insurance', 'Device Protection', 'Extended Warranty', 'Service Call',
                     'Installation Fee', 'Activation Fee', 'Late Fee', 'Reconnection Fee', 'Upgrade Fee'];
    v_observations := ARRAY['Monthly usage', 'Quarterly bill', 'Monthly usage', 'Monthly subscription', 'Monthly plan',
                            'Monthly collection', 'Monthly service', 'Annual premium', 'Annual premium', 'Monthly monitoring',
                            'Home phone', 'Device coverage', 'Annual coverage', 'Extended protection', 'Emergency call',
                            'New service', 'Account setup', 'Payment penalty', 'Service restoration', 'Plan upgrade'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 50 + 15)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_utilities, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- Personal Care (20 records)
    v_names := ARRAY['Haircut', 'Shampoo', 'Conditioner', 'Body Wash', 'Deodorant',
                     'Toothpaste', 'Toothbrush', 'Skincare', 'Makeup', 'Perfume',
                     'Nail Care', 'Hair Products', 'Razors', 'Shaving Cream', 'Sunscreen',
                     'Lip Balm', 'Hand Cream', 'Face Mask', 'Essential Oils', 'Spa Treatment'];
    v_observations := ARRAY['Monthly trim', 'Weekly wash', 'After shampoo', 'Daily shower', 'Daily use',
                            'Daily hygiene', 'Monthly replacement', 'Daily routine', 'Special occasion', 'Daily wear',
                            'Monthly manicure', 'Styling products', 'Monthly supply', 'Daily shave', 'Daily protection',
                            'Daily use', 'Daily moisture', 'Weekly treatment', 'Aromatherapy', 'Relaxation session'];
    
    FOR i IN 1..20 LOOP
        v_amount := (random() * 40 + 10)::numeric(14,2);
        INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
        VALUES (v_month_jul_2026, v_cat_personal, v_names[i], v_observations[i], v_amount);
    END LOOP;
    
    -- ============================================================================
    -- 9. July 2026: Create income records
    -- ============================================================================
    
    -- Salary (2 records)
    INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_jul_2026, v_cat_salary, 'Monthly Salary', 3500.00),
        (v_month_jul_2026, v_cat_salary, 'Overtime Payment', 450.00);
    
    -- Freelance (3 records)
    INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_jul_2026, v_cat_freelance, 'Web Design Project', 1200.00),
        (v_month_jul_2026, v_cat_freelance, 'Consulting Fee', 800.00),
        (v_month_jul_2026, v_cat_freelance, 'Logo Design', 350.00);
    
    -- Investments (2 records)
    INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_jul_2026, v_cat_investments, 'Stock Dividends', 125.50),
        (v_month_jul_2026, v_cat_investments, 'Bond Interest', 75.00);
    
    -- Rental Income (1 record)
    INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_jul_2026, v_cat_rental, 'Apartment Rent', 950.00);
    
    -- Bonuses (1 record)
    INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_jul_2026, v_cat_bonuses, 'Quarterly Bonus', 500.00);
    
    -- Side Business (2 records)
    INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_jul_2026, v_cat_side_business, 'E-commerce Sales', 680.00),
        (v_month_jul_2026, v_cat_side_business, 'Digital Products', 220.00);
    
    -- Gifts (1 record)
    INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_jul_2026, v_cat_gifts, 'Birthday Gift', 200.00);
    
    -- Refunds (2 records)
    INSERT INTO month_income (month_id, category_id, name, amount) VALUES
        (v_month_jul_2026, v_cat_refunds, 'Product Return', 85.00),
        (v_month_jul_2026, v_cat_refunds, 'Service Credit', 45.00);
    
    RAISE NOTICE 'Seed data created successfully!';
    RAISE NOTICE '- 10 expense categories';
    RAISE NOTICE '- 10 income categories';
    RAISE NOTICE '- 10 committed templates';
    RAISE NOTICE '- 10 estimated templates';
    RAISE NOTICE '- 79 months (2020-2025 full + Jan-Jul 2026)';
    RAISE NOTICE '- 20 cloned fixed lines in Jul 2026';
    RAISE NOTICE '- 200 actual expenses in Jul 2026';
    RAISE NOTICE '- 14 income records in Jul 2026';
END $$;

COMMIT;
