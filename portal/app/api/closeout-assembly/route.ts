import { NextRequest, NextResponse } from "next/server";
import { projectContext } from "@/lib/project-file/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await projectContext(req.nextUrl.searchParams.get("project_id"));
  if (!gate.ok) return gate.response;
  const db = gate.ctx.db;
  const tenantId = gate.ctx.tenantId;
  const projectId = gate.projectId;

  const [pins, submittals, equipment, inspections, coInspections] = await Promise.all([
    db.from("sheet_pins").select("id, page_id, entity_id, label, x, y").eq("tenant_id", tenantId).eq("project_id", projectId).eq("entity_type", "punch"),
    db.from("submittal_items").select("id, title, spec_section, status, submittal_type, warranty_end_date").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("equipment_suppliers").select("id, name, notes").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("project_inspections").select("*").eq("tenant_id", tenantId).eq("project_id", projectId),
    db.from("co_inspections").select("id, inspection_type, status, result_date").eq("tenant_id", tenantId).eq("project_id", projectId),
  ]);

  const punchIds = new Set(((pins.data ?? []) as Array<{ entity_id: string }>).map((pin) => pin.entity_id));
  const { data: punchItems } = punchIds.size
    ? await db.from("punch_list_items").select("id, description, status").in("id", [...punchIds]).eq("tenant_id", tenantId)
    : { data: [] };
  const openPunch = new Set((punchItems ?? []).filter((item: { status: string }) => item.status !== "approved" && item.status !== "complete").map((item: { id: string }) => item.id));

  const approved = (submittals.data ?? []).filter((row: { status: string }) => row.status === "approved" || row.status === "approved_as_noted");
  const manuals = approved.filter((row: { submittal_type: string }) => row.submittal_type === "manual");

  return NextResponse.json({
    punch_walk: (pins.data ?? []).filter((pin: { entity_id: string }) => openPunch.has(pin.entity_id)),
    closeout_manual: approved,
    warranty: [
      ...manuals.map((row: { id: string; title: string; warranty_end_date: string | null }) => ({
        id: row.id,
        name: row.title,
        warranty_end_date: row.warranty_end_date,
        source: "submittal",
      })),
      ...((equipment.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => ({
        id: row.id,
        name: row.name,
        warranty_end_date: null,
        source: "equipment",
      })),
    ],
    inspections: inspections.data ?? [],
    certificate_inspections: coInspections.data ?? [],
  });
}
