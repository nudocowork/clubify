-- Agrega CLUVI al enum MenuLayout (dark bg + yellow accents, estilo cluvi.co)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'CLUVI'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'MenuLayout')
  ) THEN
    ALTER TYPE "MenuLayout" ADD VALUE 'CLUVI';
  END IF;
END $$;
