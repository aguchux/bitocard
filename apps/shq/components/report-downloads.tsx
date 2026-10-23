"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { Button, errorMessage } from "@bitocard/admin-ui";
import { downloadResellerStatement, type ResellerReportRange } from "@bitocard/api-client/reseller";

/**
 * The statement's CSV and PDF downloads for a period, for the account and mode in use. Downloaded through the API
 * client (never a plain link, which could not name the account), with the API's own message when one is refused.
 */
export function ReportDownloads({ range }: { range: ResellerReportRange }) {
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (format: "csv" | "pdf") => {
    setBusy(format);
    setError(null);
    try {
      await downloadResellerStatement(format, range);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => download("csv")}>
          <Download className="size-4" aria-hidden /> {busy === "csv" ? "Preparing…" : "CSV"}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => download("pdf")}>
          <FileText className="size-4" aria-hidden /> {busy === "pdf" ? "Preparing…" : "PDF"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
