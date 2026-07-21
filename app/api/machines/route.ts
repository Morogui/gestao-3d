import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sql`
    SELECT id, nome, ativa FROM machines ORDER BY id ASC
  `;
  return NextResponse.json(rows);
}
