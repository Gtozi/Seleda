-- Banquet & Events logistics tables (resources, equipment, vendors, transportation)

CREATE TABLE IF NOT EXISTS public.banquet_resources (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_name text NOT NULL,
  quantity integer DEFAULT 0,
  allocated_to text,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_resources_event ON public.banquet_resources(event_id);

CREATE TABLE IF NOT EXISTS public.banquet_equipment (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  equipment_name text NOT NULL,
  equipment_type text NOT NULL,
  quantity integer DEFAULT 0,
  specifications text,
  assigned_to text,
  status text DEFAULT 'Available',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_equipment_event ON public.banquet_equipment(event_id);

CREATE TABLE IF NOT EXISTS public.banquet_vendors (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  vendor_type text NOT NULL,
  contact_person text,
  phone text,
  email text,
  services text,
  contract_value numeric DEFAULT 0,
  status text DEFAULT 'Pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_vendors_event ON public.banquet_vendors(event_id);

CREATE TABLE IF NOT EXISTS public.banquet_transportation (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text REFERENCES public.banquet_events(id) ON DELETE CASCADE,
  guest_name text,
  pickup_location text,
  dropoff_location text,
  pickup_time timestamptz,
  vehicle_type text NOT NULL,
  passenger_count integer DEFAULT 0,
  special_requests text,
  driver_name text,
  contact_number text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_transportation_event ON public.banquet_transportation(event_id);
