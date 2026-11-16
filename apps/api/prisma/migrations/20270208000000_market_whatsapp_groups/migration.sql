-- Each market keeps the invite link of BitoCard's WhatsApp group for its resellers, set by admins (Settings > Markets)
-- and only ever sent to a reseller of that market in the "Join our WhatsApp group" email. Never public.
ALTER TABLE "countries" ADD COLUMN "whatsapp_group_url" TEXT;
