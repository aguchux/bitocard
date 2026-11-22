-- Support ticket messages may be written as rich text (bold, lists, links...): the cleaned HTML beside the plain words.
ALTER TABLE "support_ticket_messages" ADD COLUMN "body_html" TEXT;
