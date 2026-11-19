-- Consolidate Wine List to Beverage List
-- Update existing data and expand to support all beverage types

-- Step 1: Drop the old constraint first
ALTER TABLE fb_wine_list DROP CONSTRAINT IF EXISTS fb_wine_list_wine_type_check;

-- Step 2: Update existing wine_type values to new naming convention
UPDATE fb_wine_list SET wine_type = 'Red Wine' WHERE wine_type = 'Red';
UPDATE fb_wine_list SET wine_type = 'White Wine' WHERE wine_type = 'White';
UPDATE fb_wine_list SET wine_type = 'Rose Wine' WHERE wine_type = 'Rose';
UPDATE fb_wine_list SET wine_type = 'Sparkling Wine' WHERE wine_type = 'Sparkling';
UPDATE fb_wine_list SET wine_type = 'Dessert Wine' WHERE wine_type = 'Dessert';
UPDATE fb_wine_list SET wine_type = 'Fortified Wine' WHERE wine_type = 'Fortified';

-- Step 3: Add new columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fb_wine_list' AND column_name = 'brand'
  ) THEN
    ALTER TABLE fb_wine_list ADD COLUMN brand TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fb_wine_list' AND column_name = 'size_or_volume'
  ) THEN
    ALTER TABLE fb_wine_list ADD COLUMN size_or_volume TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fb_wine_list' AND column_name = 'package_type'
  ) THEN
    ALTER TABLE fb_wine_list ADD COLUMN package_type TEXT CHECK (package_type IN ('Bottle', 'Can', 'Keg', 'Draft', 'Box', 'Other'));
  END IF;
END $$;

-- Step 4: Add the new constraint with all beverage types
ALTER TABLE fb_wine_list ADD CONSTRAINT fb_wine_list_wine_type_check 
  CHECK (wine_type IN ('Red Wine', 'White Wine', 'Rose Wine', 'Sparkling Wine', 'Dessert Wine', 'Fortified Wine', 
                        'Beer', 'Cider', 'Spirits', 'Liqueur', 'Cocktail', 'Mocktail', 
                        'Coffee', 'Tea', 'Soft Drink', 'Juice', 'Water', 'Energy Drink', 'Other'));

-- Step 5: Update column comments
COMMENT ON COLUMN fb_wine_list.wine_type IS 'Beverage type - expanded to include all beverages, not just wine';
COMMENT ON COLUMN fb_wine_list.vintage IS 'Year vintage (for wines) - optional for other beverages';
COMMENT ON COLUMN fb_wine_list.grape_variety IS 'Grape variety (for wines) or product type (for other beverages)';