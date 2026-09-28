export function GET() {
  return Response.json({ status: "ok", service: "bitocard-api" }, { headers: { "Cache-Control": "no-store" } });
}
