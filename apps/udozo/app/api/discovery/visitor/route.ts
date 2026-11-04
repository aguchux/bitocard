import { type NextRequest, NextResponse } from "next/server";
import { consentsToOptional, currentVisitor, dropVisitor, keepVisitor } from "@/lib/discovery-server";

const done = () => new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
const sameSite = (request: NextRequest) => request.headers.get("sec-fetch-site") === "same-origin";

/**
 * The visitor's ID (`udz_vid`), kept only while they chose Accept all: the tracker asks for one after that choice (and
 * on a later visit that has none), and this route sets it only when the consent cookie says Accept all. Only from this
 * site's own pages.
 */
export async function POST(request: NextRequest) {
  if (!sameSite(request) || !(await consentsToOptional()) || (await currentVisitor())) return done();
  await keepVisitor();
  return done();
}

/** Necessary only: the visitor's ID and what Udozo kept under it go. */
export async function DELETE(request: NextRequest) {
  if (!sameSite(request)) return done();
  await dropVisitor();
  return done();
}
