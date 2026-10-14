import { ReviewCaseDetail } from "./detail";

export default async function ReviewCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewCaseDetail id={id} />;
}
