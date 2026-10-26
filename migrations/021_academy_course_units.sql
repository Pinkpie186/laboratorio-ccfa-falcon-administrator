CREATE TABLE IF NOT EXISTS course_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submodule_id uuid NOT NULL REFERENCES submodules(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  title text NOT NULL,
  summary text,
  source_status text NOT NULL DEFAULT 'index_only' CHECK (source_status IN ('index_only','content_reviewed')),
  source_url text NOT NULL,
  consulted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(submodule_id,title)
);
CREATE INDEX IF NOT EXISTS course_units_module_position_idx ON course_units(submodule_id,position);
