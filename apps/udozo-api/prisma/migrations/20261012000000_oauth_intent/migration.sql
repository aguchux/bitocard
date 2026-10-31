-- Google sign-up is deliberate: only a round trip started to sign up creates an account.
CREATE TYPE "OAuthIntent" AS ENUM ('signin', 'signup', 'link');

ALTER TABLE "oauth_states" ADD COLUMN "intent" "OAuthIntent" NOT NULL DEFAULT 'signin';
