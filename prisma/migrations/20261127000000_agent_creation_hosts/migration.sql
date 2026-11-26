-- Existing grants receive no creation authority.
ALTER TABLE "OAuthGrant" ADD COLUMN "creationHosts" TEXT NOT NULL DEFAULT '[]';
