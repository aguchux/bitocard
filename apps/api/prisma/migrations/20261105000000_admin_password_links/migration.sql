-- Set-password links emailed to admins by the admin:create and admin:reset-password scripts.
ALTER TYPE "CodePurpose" ADD VALUE 'admin_password_link';
