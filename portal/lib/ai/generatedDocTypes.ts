/**
 * Catalog of AI-generated document types. Single source of truth used by both
 * the /api/generated-docs route (server prompts) and the UI (dropdown labels).
 *
 * Adding a new doc type? Add an entry here, then update both the dropdown and
 * the server prompt without searching the codebase.
 */

export interface GeneratedDocType {
  key: string;
  label: string;
  hint: string;
  systemPrompt: string;
  promptTemplate: (projectName?: string) => string;
}

export const GENERATED_DOC_TYPES: GeneratedDocType[] = [
  {
    key: "rfi",
    label: "RFI Document",
    hint: "Draft a Request for Information",
    systemPrompt:
      "You draft formal construction RFIs (Requests for Information). Output a complete RFI with: " +
      "Subject, RFI number placeholder, To/From, Date placeholder, Reference (spec/drawing), " +
      "Question (clear and specific), Suggested Resolution, and required response date. " +
      "Tone is professional and concise. Use plain text with clear section headers.",
    promptTemplate: () =>
      "Using the attached plans and any project context, draft an RFI for a specific issue you can identify in the documents (a conflict, missing detail, or ambiguity). If you cannot identify a specific issue, draft a placeholder RFI shell with clear blanks for the user to fill in.",
  },
  {
    key: "daily_log",
    label: "Daily Log",
    hint: "End-of-day field log",
    systemPrompt:
      "You write structured construction daily logs. Output sections: Date, Weather (temp, conditions, wind), " +
      "Crew on Site (trade + count), Work Performed Today (by area/trade), Materials Delivered, Equipment On Site, " +
      "Visitors/Inspectors, Safety Incidents (or 'None'), Issues/Delays, Photos taken (placeholder count), " +
      "Tomorrow's Plan. Be specific to the project — pull dimensions, areas, materials from the plans.",
    promptTemplate: () =>
      "Generate a daily log entry for today based on the plans and any current project context. Where specific values aren't known, leave clearly labeled placeholders.",
  },
  {
    key: "project_update",
    label: "Project Update",
    hint: "Owner / stakeholder status update",
    systemPrompt:
      "You write executive project updates for owners, architects, and lenders. Output: Project name & period covered, " +
      "Schedule Status (on track / ahead / behind with quantified variance), Budget Status (% used, projected at completion), " +
      "Major Milestones Completed, Upcoming Milestones, Open Issues Requiring Owner Action, Decisions Needed, " +
      "Photos / Site Progress Summary. Tone is direct, no construction jargon without explanation.",
    promptTemplate: () =>
      "Draft this period's project update from the plans and any project context. Be specific. Flag risks before they become problems.",
  },
  {
    key: "risk_assessment",
    label: "Risk Assessment",
    hint: "Project-specific risk register",
    systemPrompt:
      "You produce construction project risk assessments. Output a numbered risk register, each entry containing: " +
      "Risk ID, Category (Schedule/Cost/Safety/Quality/Regulatory/Supply Chain), Description, " +
      "Likelihood (Low/Med/High), Impact (Low/Med/High), Risk Score, Mitigation Strategy, Owner, " +
      "Trigger Indicators. Sort by Risk Score descending. Be specific to the project type and scope visible in the plans.",
    promptTemplate: () =>
      "Identify the top 10 risks for this project based on the uploaded plans and project context. For each, write actionable mitigation steps.",
  },
  {
    key: "value_engineering",
    label: "Value Engineering",
    hint: "Cost-saving alternatives",
    systemPrompt:
      "You produce value engineering proposals for construction projects. Output a numbered list of VE options, " +
      "each containing: Option #, Original Specification, Proposed Alternative, Estimated Savings ($), " +
      "Schedule Impact, Quality/Performance Impact, Owner Decision Required (Y/N), Notes. " +
      "Sort by savings descending. Be honest about quality tradeoffs — don't suggest cheaper-with-no-downside options unless they truly exist.",
    promptTemplate: () =>
      "Review the plans and propose value engineering options that could reduce cost without unacceptable quality loss. Quantify savings where possible from typical industry pricing.",
  },
  {
    key: "spec_materials",
    label: "Spec Material List",
    hint: "Specified materials and finishes",
    systemPrompt:
      "You extract and organize the specified materials and finishes from construction documents. Output a list organized " +
      "by CSI Division (03 Concrete, 04 Masonry, 05 Metals, 06 Wood, 07 Thermal/Moisture, 08 Openings, 09 Finishes, etc.). " +
      "For each material: CSI Code, Material/Product, Manufacturer (if specified), Model/Series, Color/Finish, " +
      "Location in project, Spec Section Reference, Notes. Be exhaustive — every specified material counts.",
    promptTemplate: () =>
      "Extract every specified material from the uploaded plans and spec documents. Organize by CSI Division.",
  },
  {
    key: "equipment_log",
    label: "Equipment Log",
    hint: "On-site equipment register",
    systemPrompt:
      "You maintain construction equipment logs. Output a register with columns: Equipment ID, Type, Make/Model, " +
      "Owner (rented from / owned), Daily/Weekly Rate if rented, On-Site Date, Expected Off-Site Date, Operator, " +
      "Last Inspection, Current Status (operating / down / awaiting parts), Notes. Group by equipment type.",
    promptTemplate: () =>
      "Generate an equipment log for this project — populate from any equipment referenced in the plans or context. Use placeholders where specifics aren't known.",
  },
  {
    key: "takeoff_report",
    label: "Takeoff Report",
    hint: "Quantity takeoff summary",
    systemPrompt:
      "You produce construction quantity takeoff reports. Output: Project Name, Sheet Set Reference, Takeoff Date placeholder, " +
      "Estimator. Then a CSI-organized table of items: CSI Code, Description, Quantity, Unit, Source Drawing/Page, Notes. " +
      "Include subtotals per CSI Division and a grand line count. Note any assumptions made.",
    promptTemplate: () =>
      "Generate a quantity takeoff report from the uploaded plans. Pull dimensions, areas, counts where possible. Where exact quantities require detailed measurement, provide reasonable estimates and flag as 'estimated'.",
  },
  {
    key: "estimate_report",
    label: "Estimating Report",
    hint: "Cost estimate summary",
    systemPrompt:
      "You produce construction cost estimate reports. Output: Project Name, Estimate Date placeholder, Estimator, " +
      "Bid/Type (Hard Bid / GMP / T&M), CSI-organized cost breakdown table (CSI Code, Description, Quantity, Unit, " +
      "Unit Cost, Total), General Conditions, General Requirements, Overhead %, Profit %, Contingency %, Grand Total. " +
      "Use industry-typical unit costs where specifics aren't given, and clearly label assumptions.",
    promptTemplate: () =>
      "Generate a cost estimate report from the uploaded plans. Use the takeoff quantities if available; otherwise estimate from drawings.",
  },
];

export function getDocTypeByKey(key: string): GeneratedDocType | undefined {
  return GENERATED_DOC_TYPES.find((t) => t.key === key);
}

export const GENERATED_DOC_TYPE_KEYS = GENERATED_DOC_TYPES.map((t) => t.key);
