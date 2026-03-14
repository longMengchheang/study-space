import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      connected: true,
      status: "ready",
      detail: "The built-in Monaco editor is ready.",
    },
    { status: 200 },
  );
}
