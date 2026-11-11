-- Udozo POS milestone 5 (docs/UDOZO_POS_PLAN.md): staff, roles and tills. An owner's staff sign in with the shop code,
-- their phone and a 4-digit PIN (or their name tile and PIN on a linked till), never with a Udozo account. What they may
-- do is their role's: four fixed roles in code, and the owner's own custom roles here.

-- The owner's own roles: each permission `yes`, `approval` or `no` (staff `no` or `cashiers`), and the most discount
-- it gives without a manager (basis points; null for any amount).
CREATE TABLE "pos_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "description" VARCHAR(200),
  "permissions" JSONB NOT NULL DEFAULT '{}',
  "discount_limit_bps" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_roles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_roles_discount_check" CHECK ("discount_limit_bps" IS NULL OR ("discount_limit_bps" >= 0 AND "discount_limit_bps" <= 10000))
);
CREATE UNIQUE INDEX "pos_roles_account_name_key" ON "pos_roles" ("account_id", lower("name"));

-- A member of staff: invited (until they set their PIN), active, suspended or removed (kept, so their sales keep their name).
CREATE TABLE "pos_staff" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "first_name" VARCHAR(60) NOT NULL,
  "last_name" VARCHAR(60) NOT NULL,
  "phone" VARCHAR(20) NOT NULL,
  "email" VARCHAR(254),
  "role_key" VARCHAR(32),
  "role_id" UUID,
  "all_tills" BOOLEAN NOT NULL DEFAULT false,
  "mobile" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(16) NOT NULL DEFAULT 'invited',
  "pin_hash" TEXT,
  "pin_set_at" TIMESTAMP(3),
  "failed_tries" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMP(3),
  "last_active_at" TIMESTAMP(3),
  "invited_by_name" VARCHAR(120) NOT NULL,
  "removed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_staff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_staff_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_staff_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "pos_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_staff_role_check" CHECK (("role_key" IS NULL) <> ("role_id" IS NULL)),
  CONSTRAINT "pos_staff_status_check" CHECK ("status" IN ('invited', 'active', 'suspended', 'removed'))
);
CREATE UNIQUE INDEX "pos_staff_account_phone_key" ON "pos_staff" ("account_id", "phone") WHERE "status" <> 'removed';
CREATE INDEX "pos_staff_account_idx" ON "pos_staff" ("account_id", "status");

-- The tills a member of staff may use (unless `all_tills`).
CREATE TABLE "pos_staff_tills" (
  "staff_id" UUID NOT NULL,
  "till_id" UUID NOT NULL,
  CONSTRAINT "pos_staff_tills_pkey" PRIMARY KEY ("staff_id", "till_id"),
  CONSTRAINT "pos_staff_tills_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "pos_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_staff_tills_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- An invitation to set a PIN (also a PIN reset): single use, 48 hours; only its hash is kept.
CREATE TABLE "pos_invites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "staff_id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "sent_via" VARCHAR(16) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "replaced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_invites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_invites_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "pos_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_invites_via_check" CHECK ("sent_via" IN ('sms', 'whatsapp', 'link'))
);
CREATE UNIQUE INDEX "pos_invites_token_hash_key" ON "pos_invites" ("token_hash");
CREATE INDEX "pos_invites_staff_idx" ON "pos_invites" ("staff_id");

-- A till's device (a browser or the app): made with a link code (10 minutes, once), then known by its token's hash.
CREATE TABLE "pos_devices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "till_id" UUID NOT NULL,
  "name" VARCHAR(60),
  "platform" VARCHAR(16),
  "code_hash" VARCHAR(64),
  "code_expires_at" TIMESTAMP(3),
  "token_hash" VARCHAR(64),
  "linked_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_by_name" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_devices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_devices_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pos_devices_code_hash_key" ON "pos_devices" ("code_hash");
CREATE UNIQUE INDEX "pos_devices_token_hash_key" ON "pos_devices" ("token_hash");
CREATE INDEX "pos_devices_account_idx" ON "pos_devices" ("account_id", "created_at" DESC);

-- A member of staff signed in, on a linked device (its till) or on the web. It ends after 12 hours idle, at sign-out,
-- or when they are suspended or removed or their device is unlinked. Only the token's hash is kept.
CREATE TABLE "pos_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "staff_id" UUID NOT NULL,
  "device_id" UUID,
  "till_id" UUID,
  "token_hash" VARCHAR(64) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "ended_reason" VARCHAR(32),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "pos_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "pos_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_sessions_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pos_sessions_token_hash_key" ON "pos_sessions" ("token_hash");
CREATE INDEX "pos_sessions_staff_idx" ON "pos_sessions" ("staff_id") WHERE "ended_at" IS NULL;

-- A manager's PIN given at the till for something a member of staff may only do with approval.
CREATE TABLE "pos_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "subject_id" UUID,
  "requested_by_staff_id" UUID NOT NULL,
  "requested_by_name" VARCHAR(120) NOT NULL,
  "approved_by_staff_id" UUID NOT NULL,
  "approved_by_name" VARCHAR(120) NOT NULL,
  "till_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_approvals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "pos_approvals_account_idx" ON "pos_approvals" ("account_id", "created_at" DESC);

-- Who did it, when it was one of the staff.
ALTER TABLE "pos_sales" ADD COLUMN "sold_by_staff_id" UUID, ADD COLUMN "refunded_by_name" VARCHAR(120), ADD COLUMN "refunded_by_staff_id" UUID;
CREATE INDEX "pos_sales_staff_idx" ON "pos_sales" ("account_id", "sold_by_staff_id", "created_at" DESC);
ALTER TABLE "pos_stock_movements" ADD COLUMN "by_staff_id" UUID;
ALTER TABLE "pos_wallet_requests" ADD COLUMN "sold_by_staff_id" UUID;
ALTER TABLE "pos_transfer_requests" ADD COLUMN "sold_by_staff_id" UUID;
