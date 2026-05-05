-- Add stampIcon emoji selector to Card (default ☕)
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampIcon" TEXT NOT NULL DEFAULT '☕';
