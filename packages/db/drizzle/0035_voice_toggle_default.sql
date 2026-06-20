UPDATE "twin_voice_settings"
SET "push_to_talk_mode" = 'toggle'
WHERE "push_to_talk_mode" = 'hold';

ALTER TABLE "twin_voice_settings"
ALTER COLUMN "push_to_talk_mode" SET DEFAULT 'toggle';
