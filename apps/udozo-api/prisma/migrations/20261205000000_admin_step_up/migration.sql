-- Admin sessions open a 5-minute window for sensitive and money actions once the admin enters their authenticator code.
ALTER TABLE "sessions" ADD COLUMN "step_up_until" TIMESTAMP(3);
