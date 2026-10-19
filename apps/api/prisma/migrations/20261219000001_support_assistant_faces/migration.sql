-- Support assistants show their face beside each answer: the picture they had when they wrote.
ALTER TABLE "support_chat_messages" ADD COLUMN "author_avatar_url" TEXT;
ALTER TABLE "support_ticket_messages" ADD COLUMN "author_avatar_url" TEXT;
-- Answers already written take their assistant's current picture.
UPDATE "support_chat_messages" m SET "author_avatar_url" = b."avatar_url" FROM "support_bots" b WHERE m."author" = 'bot' AND m."author_id" = b."id";
UPDATE "support_ticket_messages" m SET "author_avatar_url" = b."avatar_url" FROM "support_bots" b WHERE m."author" = 'bot' AND m."author_id" = b."id";
