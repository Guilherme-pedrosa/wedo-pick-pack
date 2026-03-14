
-- Add technician fields to boxes
ALTER TABLE boxes ADD COLUMN technician_name text;
ALTER TABLE boxes ADD COLUMN technician_gc_id text;

-- Create check-in records table
CREATE TABLE box_checkin_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  operator_id uuid NOT NULL,
  operator_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'in_progress',
  completed_at timestamptz,
  notes text
);

ALTER TABLE box_checkin_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read checkin_records" ON box_checkin_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert checkin_records" ON box_checkin_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update checkin_records" ON box_checkin_records FOR UPDATE TO authenticated USING (true);

-- Create check-in items table (per-product divergence tracking)
CREATE TABLE box_checkin_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id uuid NOT NULL REFERENCES box_checkin_records(id) ON DELETE CASCADE,
  box_id uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  produto_id text NOT NULL,
  nome_produto text NOT NULL,
  quantidade_esperada integer NOT NULL DEFAULT 0,
  quantidade_devolvida integer NOT NULL DEFAULT 0,
  divergencia integer NOT NULL DEFAULT 0,
  justificativa_tipo text,
  justificativa_ref text,
  justificativa_validada boolean NOT NULL DEFAULT false,
  reposto boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE box_checkin_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read checkin_items" ON box_checkin_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert checkin_items" ON box_checkin_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update checkin_items" ON box_checkin_items FOR UPDATE TO authenticated USING (true);
