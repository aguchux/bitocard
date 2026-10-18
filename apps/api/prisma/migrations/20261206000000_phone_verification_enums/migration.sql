-- New code purposes on their own (a new enum value cannot be used in the same transaction).
ALTER TYPE "CodePurpose" ADD VALUE IF NOT EXISTS 'phone_add';
ALTER TYPE "CustomerCodePurpose" ADD VALUE IF NOT EXISTS 'phone_verification';
