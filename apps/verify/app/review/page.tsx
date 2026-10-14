import { Suspense } from "react";
import { ReviewQueue } from "./queue";

/** The registered reseller's queue of their customers' ID checks. */
export default function ReviewQueuePage() {
  // The tab and customer filter are kept in the address (useSearchParams needs a Suspense boundary).
  return (
    <Suspense>
      <ReviewQueue />
    </Suspense>
  );
}
