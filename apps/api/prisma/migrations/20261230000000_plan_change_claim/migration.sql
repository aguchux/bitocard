-- One plan change per store at a time: a short claim, so two requests at once never both charge.
ALTER TABLE "stores" ADD COLUMN "plan_changing_at" TIMESTAMP(3);
