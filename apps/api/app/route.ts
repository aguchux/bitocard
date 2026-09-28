export function GET() {
  return Response.json({ service: "bitocard-api", status: "scaffold", health: "/health" });
}
