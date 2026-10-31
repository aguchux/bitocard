-- How much of something each plan allows, beside its on/off features: { "stores": 5, "team_members": null }, a number
-- or null for unlimited. A limit a plan does not set has its default in code (today's fixed values), so nothing changes.
ALTER TABLE "plans" ADD COLUMN "limits" JSONB NOT NULL DEFAULT '{}';
