-- Signed-in resellers can change their sign-in email: a code is sent to the new address.
ALTER TYPE "CodePurpose" ADD VALUE 'email_change';
