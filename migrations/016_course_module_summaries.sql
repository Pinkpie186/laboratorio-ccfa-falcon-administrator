ALTER TABLE submodules ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS key_points jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS summary_source_url text;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS summary_consulted_at timestamptz;

