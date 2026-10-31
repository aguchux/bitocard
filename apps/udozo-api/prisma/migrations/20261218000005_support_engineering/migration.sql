-- Engineering escalations: the GitHub issue a ticket became.
ALTER TABLE "support_tickets"
  ADD COLUMN "github_repo" TEXT,
  ADD COLUMN "github_issue_number" INTEGER,
  ADD COLUMN "github_issue_url" TEXT,
  ADD COLUMN "github_issue_state" TEXT,
  ADD COLUMN "engineering_at" TIMESTAMP(3);
CREATE INDEX "support_tickets_github_repo_github_issue_number_idx" ON "support_tickets"("github_repo", "github_issue_number");
