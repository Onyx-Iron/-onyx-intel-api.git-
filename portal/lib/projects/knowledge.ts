import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { listCurrentEstimateItems } from "@/lib/estimating/current-version";

type Row = Record<string, unknown>;

export interface ProjectKnowledgeSnapshot {
  generated_at: string;
  project: Row;
  documents: {
    total: number;
    processing: number;
    failed: number;
    ready: number;
    extracted_pages: number;
    recent: Row[];
  };
  takeoff: {
    total: number;
    approved: number;
    needs_review: number;
    rejected: number;
    recent: Row[];
  };
  estimate: {
    line_items: number;
    value: number;
    unpriced: number;
    needs_review: number;
    recent: Row[];
  };
  schedule: {
    total: number;
    complete: number;
    overdue: number;
    critical_open: number;
    upcoming: Row[];
  };
  controls: {
    open_rfis: number;
    overdue_rfis: number;
    open_submittals: number;
    overdue_submittals: number;
    pending_change_orders: number;
    pending_change_order_value: number;
    rfis: Row[];
    submittals: Row[];
    change_orders: Row[];
  };
  procurement: {
    outstanding: number;
    overdue: number;
    items: Row[];
  };
  financials: {
    receivable_open: number;
    payable_open: number;
    receivable_balance: number;
    payable_balance: number;
    lien_waivers_open: number;
    invoices: Row[];
  };
  field: {
    daily_logs: number;
    weekly_logs: number;
    open_todos: number;
    staff: number;
    recent_daily_logs: Row[];
    recent_weekly_logs: Row[];
  };
  closeout: {
    punch_open: number;
    permits_open: number;
    inspections_open: number;
    punch_items: Row[];
  };
  people_and_vendors: {
    contacts: number;
    material_vendors: number;
    equipment_suppliers: number;
  };
  knowledge: {
    extracted_facts: number;
    document_chunks: number;
    conversations: number;
    messages: number;
    generated_documents: number;
    recent_generated_documents: Row[];
  };
  history: Row[];
}

function data(result: { data?: unknown[] | null }): Row[] {
  return (result.data ?? []) as Row[];
}

function text(row: Row, key: string): string {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function number(row: Row, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function isOpenStatus(value: unknown): boolean {
  return !["complete", "completed", "closed", "paid", "approved", "delivered", "done", "canceled", "cancelled", "rejected"].includes(String(value ?? "").toLowerCase());
}

function isBeforeToday(value: unknown, today: string): boolean {
  return typeof value === "string" && value.length >= 10 && value.slice(0, 10) < today;
}

function estimateLineValue(row: Row): number {
  const explicit = number(row, "total_price");
  if (explicit > 0) return explicit;
  return number(row, "quantity") * number(row, "unit_cost");
}

/**
 * Loads the canonical, tenant-scoped project snapshot used by project AI,
 * reports, and the project knowledge API. Every domain is fetched together so
 * no feature silently reasons over a smaller tab-specific view of the project.
 */
export async function loadProjectKnowledgeSnapshot(
  tenantId: string,
  projectId: string,
): Promise<ProjectKnowledgeSnapshot | null> {
  const db = await createServiceClient();
  // The generated types can lag migrations; all queries remain tenant/project scoped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = db as any;
  const scoped = (table: string, columns: string, limit = 1000) =>
    q.from(table).select(columns, { count: "exact" }).eq("tenant_id", tenantId).eq("project_id", projectId).limit(limit);
  const count = (table: string) =>
    q.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("project_id", projectId);

  const projectResult = await q
    .from("projects")
    .select("id,name,status,budget,start_date,end_date,address,city,state,zip_code,meta,created_at,updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle();
  if (!projectResult.data) return null;

  const [
    documentsResult,
    takeoffResult,
    scheduleResult,
    rfisResult,
    submittalsResult,
    changeOrdersResult,
    procurementResult,
    invoicesResult,
    waiversResult,
    dailyResult,
    weeklyResult,
    todoResult,
    staffResult,
    punchResult,
    permitsResult,
    inspectionsResult,
    contactsCount,
    materialVendorsCount,
    equipmentSuppliersCount,
    memoriesCount,
    chunksCount,
    conversationsResult,
    generatedResult,
    historyResult,
  ] = await Promise.all([
    scoped("documents", "id,file_name,status,ocr_status,split_status,vector_status,takeoff_status,page_count,last_error,last_error_step,uploaded_at,processed_at", 2000),
    scoped("takeoff_items", "id,label,csi_code,quantity,unit,review_status,source_method,document_id,sheet_id,created_at,updated_at", 5000),
    scoped("schedule_tasks", "id,name,status,start_date,end_date,critical,total_float,updated_at", 3000),
    scoped("rfi_items", "id,number,subject,status,priority,due_date,assigned_to,updated_at", 1000),
    scoped("submittal_items", "id,number,title,status,spec_section,due_date,responsible,updated_at", 1000),
    scoped("change_order_items", "id,number,description,status,amount,reason,updated_at", 1000),
    scoped("procurement_items", "id,description,status,supplier,quantity,unit_cost,required_date,delivery_date,po_number,updated_at", 2000),
    scoped("invoices", "id,direction,status,amount,retainage,due_date,vendor_or_customer,invoice_number,updated_at", 3000),
    scoped("lien_waivers", "id,status,vendor_name,amount,through_date,waiver_type,updated_at", 1000),
    q.from("daily_logs").select("id,log_date,weather,crew_count,work_performed,notes,updated_at", { count: "exact" }).eq("tenant_id", tenantId).eq("project_id", projectId).order("log_date", { ascending: false }).limit(50),
    q.from("weekly_logs").select("id,week_start,week_end,schedule_status,budget_status,summary,open_issues,decisions_needed,updated_at", { count: "exact" }).eq("tenant_id", tenantId).eq("project_id", projectId).order("week_end", { ascending: false }).limit(25),
    scoped("todo_items", "id,title,status,priority,due_date,assignee,updated_at", 2000),
    scoped("staff_members", "id,name,role,project_role,removed_at,updated_at", 1000),
    scoped("punch_list_items", "id,item_number,description,status,priority,due_date,responsible,location,updated_at", 2000),
    scoped("permit_items", "id,permit_type,status,required,submit_date,approval_date,expiry_date,authority,updated_at", 1000),
    scoped("co_inspections", "id,inspection_type,certificate_type,status,scheduled_date,result_date,corrective_actions,updated_at", 1000),
    count("contacts"),
    count("material_vendors"),
    count("equipment_suppliers"),
    count("memories"),
    count("chunks"),
    scoped("conversations", "id,message_count,summary,created_at", 1000),
    q.from("generated_documents").select("id,title,doc_type,provider,created_at,updated_at", { count: "exact" }).eq("tenant_id", tenantId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(50),
    q.from("project_data_history").select("id,revision,table_name,entity_id,operation,actor_user_id,transaction_id,changed_at").eq("tenant_id", tenantId).eq("project_id", projectId).order("revision", { ascending: false }).limit(50),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const documents = data(documentsResult);
  const takeoff = data(takeoffResult);
  const estimate = await listCurrentEstimateItems(q, tenantId, projectId);
  const schedule = data(scheduleResult);
  const rfis = data(rfisResult);
  const submittals = data(submittalsResult);
  const changeOrders = data(changeOrdersResult);
  const procurement = data(procurementResult);
  const invoices = data(invoicesResult);
  const waivers = data(waiversResult);
  const daily = data(dailyResult);
  const weekly = data(weeklyResult);
  const todos = data(todoResult);
  const staff = data(staffResult);
  const punch = data(punchResult);
  const permits = data(permitsResult);
  const inspections = data(inspectionsResult);
  const conversations = data(conversationsResult);
  const generated = data(generatedResult);

  const openRfis = rfis.filter((row) => isOpenStatus(row.status));
  const openSubmittals = submittals.filter((row) => isOpenStatus(row.status));
  const pendingChangeOrders = changeOrders.filter((row) => isOpenStatus(row.status));
  const outstandingProcurement = procurement.filter((row) => isOpenStatus(row.status));
  const openInvoices = invoices.filter((row) => isOpenStatus(row.status));
  const receivables = openInvoices.filter((row) => text(row, "direction") === "receivable");
  const payables = openInvoices.filter((row) => text(row, "direction") === "payable");

  return {
    generated_at: new Date().toISOString(),
    project: projectResult.data as Row,
    documents: {
      total: documentsResult.count ?? documents.length,
      processing: documents.filter((row) => ["pending", "processing", "queued"].includes(text(row, "status"))).length,
      failed: documents.filter((row) => ["error", "failed"].includes(text(row, "status")) || Boolean(row.last_error)).length,
      ready: documents.filter((row) => ["ready", "complete", "completed", "processed"].includes(text(row, "status"))).length,
      extracted_pages: documents.reduce((sum, row) => sum + number(row, "page_count"), 0),
      recent: documents.slice(-20).reverse(),
    },
    takeoff: {
      total: takeoffResult.count ?? takeoff.length,
      approved: takeoff.filter((row) => text(row, "review_status") === "approved").length,
      needs_review: takeoff.filter((row) => ["suggested", "reviewed", "pending_review"].includes(text(row, "review_status"))).length,
      rejected: takeoff.filter((row) => text(row, "review_status") === "rejected").length,
      recent: takeoff.slice(-25).reverse(),
    },
    estimate: {
      line_items: estimate.length,
      value: Math.round(estimate.reduce((sum, row) => sum + estimateLineValue(row), 0) * 100) / 100,
      unpriced: estimate.filter((row) => number(row, "unit_cost") <= 0 && number(row, "total_price") <= 0).length,
      needs_review: estimate.filter((row) => text(row, "pricing_status") === "review").length,
      recent: estimate.slice(-25).reverse(),
    },
    schedule: {
      total: scheduleResult.count ?? schedule.length,
      complete: schedule.filter((row) => !isOpenStatus(row.status)).length,
      overdue: schedule.filter((row) => isOpenStatus(row.status) && isBeforeToday(row.end_date, today)).length,
      critical_open: schedule.filter((row) => row.critical === true && isOpenStatus(row.status)).length,
      upcoming: schedule.filter((row) => isOpenStatus(row.status)).sort((a, b) => text(a, "end_date").localeCompare(text(b, "end_date"))).slice(0, 25),
    },
    controls: {
      open_rfis: openRfis.length,
      overdue_rfis: openRfis.filter((row) => isBeforeToday(row.due_date, today)).length,
      open_submittals: openSubmittals.length,
      overdue_submittals: openSubmittals.filter((row) => isBeforeToday(row.due_date, today)).length,
      pending_change_orders: pendingChangeOrders.length,
      pending_change_order_value: pendingChangeOrders.reduce((sum, row) => sum + number(row, "amount"), 0),
      rfis: openRfis.slice(0, 25),
      submittals: openSubmittals.slice(0, 25),
      change_orders: pendingChangeOrders.slice(0, 25),
    },
    procurement: {
      outstanding: outstandingProcurement.length,
      overdue: outstandingProcurement.filter((row) => isBeforeToday(row.required_date, today)).length,
      items: outstandingProcurement.slice(0, 25),
    },
    financials: {
      receivable_open: receivables.length,
      payable_open: payables.length,
      receivable_balance: receivables.reduce((sum, row) => sum + number(row, "amount"), 0),
      payable_balance: payables.reduce((sum, row) => sum + number(row, "amount"), 0),
      lien_waivers_open: waivers.filter((row) => isOpenStatus(row.status)).length,
      invoices: openInvoices.slice(0, 25),
    },
    field: {
      daily_logs: dailyResult.count ?? daily.length,
      weekly_logs: weeklyResult.count ?? weekly.length,
      open_todos: todos.filter((row) => isOpenStatus(row.status)).length,
      staff: staff.filter((row) => !row.removed_at).length,
      recent_daily_logs: daily.slice(0, 10),
      recent_weekly_logs: weekly.slice(0, 6),
    },
    closeout: {
      punch_open: punch.filter((row) => isOpenStatus(row.status)).length,
      permits_open: permits.filter((row) => row.required !== false && isOpenStatus(row.status)).length,
      inspections_open: inspections.filter((row) => isOpenStatus(row.status)).length,
      punch_items: punch.filter((row) => isOpenStatus(row.status)).slice(0, 25),
    },
    people_and_vendors: {
      contacts: contactsCount.count ?? 0,
      material_vendors: materialVendorsCount.count ?? 0,
      equipment_suppliers: equipmentSuppliersCount.count ?? 0,
    },
    knowledge: {
      extracted_facts: memoriesCount.count ?? 0,
      document_chunks: chunksCount.count ?? 0,
      conversations: conversations.length,
      messages: conversations.reduce((sum, row) => sum + number(row, "message_count"), 0),
      generated_documents: generatedResult.count ?? generated.length,
      recent_generated_documents: generated.slice(0, 15),
    },
    history: data(historyResult),
  };
}

export function formatProjectKnowledgeForAi(snapshot: ProjectKnowledgeSnapshot): string {
  const concise = {
    ...snapshot,
    documents: { ...snapshot.documents, recent: snapshot.documents.recent.slice(0, 10) },
    takeoff: { ...snapshot.takeoff, recent: snapshot.takeoff.recent.slice(0, 12) },
    estimate: { ...snapshot.estimate, recent: snapshot.estimate.recent.slice(0, 12) },
    schedule: { ...snapshot.schedule, upcoming: snapshot.schedule.upcoming.slice(0, 12) },
    controls: {
      ...snapshot.controls,
      rfis: snapshot.controls.rfis.slice(0, 10),
      submittals: snapshot.controls.submittals.slice(0, 10),
      change_orders: snapshot.controls.change_orders.slice(0, 10),
    },
    procurement: { ...snapshot.procurement, items: snapshot.procurement.items.slice(0, 10) },
    financials: { ...snapshot.financials, invoices: snapshot.financials.invoices.slice(0, 10) },
    closeout: { ...snapshot.closeout, punch_items: snapshot.closeout.punch_items.slice(0, 10) },
    history: snapshot.history.slice(0, 15),
  };
  return [
    "--- Unified Project Knowledge ---",
    JSON.stringify(concise),
    "--- End Unified Project Knowledge ---",
  ].join("\n");
}
