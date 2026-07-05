/**
 * Onyx Intel — Website Builder Backend
 * Stores generated pages as HTML files in data/website/
 * Serves them at /website/:page for live preview
 */
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./store.js";

const SITE_DIR = path.join(DATA, "website");
const SETTINGS_FILE = path.join(SITE_DIR, "_settings.json");

function ensureDir() {
  if (!fs.existsSync(SITE_DIR)) fs.mkdirSync(SITE_DIR, { recursive: true });
}

// ── Settings (business info for website) ─────────────────────────────────────
export function getWebsiteSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); }
  catch {
    return {
      businessName: "Onyx & Iron Construction",
      tagline: "Built on Integrity. Finished with Excellence.",
      phone: "",
      email: "justinatteberry@onyx-iron.com",
      address: "Dallas–Fort Worth Metroplex, Texas",
      serviceArea: ["Dallas", "Fort Worth", "Plano", "Frisco", "McKinney", "Allen", "Denton", "Arlington"],
      services: [
        "Commercial General Contracting",
        "Residential Construction",
        "Construction Management",
        "Preconstruction Services",
        "Design-Build",
        "Renovation & Tenant Improvement",
      ],
      founded: "Onyx & Iron Construction",
      license: "",
      naicsCode: "236220",
      logo: "",
      primaryColor: "#a3e635",
      pages: {},
    };
  }
}

export function saveWebsiteSettings(patch) {
  ensureDir();
  const current = getWebsiteSettings();
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

// ── Pages ─────────────────────────────────────────────────────────────────────
export function savePage(name, html, meta = {}) {
  ensureDir();
  const safeName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const file = path.join(SITE_DIR, `${safeName}.html`);
  const metaFile = path.join(SITE_DIR, `${safeName}.meta.json`);
  fs.writeFileSync(file, html, "utf8");
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, savedAt: new Date().toISOString() }, null, 2));

  // Update settings page index
  const settings = getWebsiteSettings();
  if (!settings.pages) settings.pages = {};
  settings.pages[safeName] = { meta, updatedAt: new Date().toISOString() };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

  return { name: safeName, file, meta };
}

export function getPage(name) {
  ensureDir();
  const safeName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const file = path.join(SITE_DIR, `${safeName}.html`);
  const metaFile = path.join(SITE_DIR, `${safeName}.meta.json`);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, "utf8");
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch {}
  return { name: safeName, html, meta };
}

export function listPages() {
  ensureDir();
  const files = fs.readdirSync(SITE_DIR).filter(f => f.endsWith(".html") && !f.startsWith("_"));
  return files.map(f => {
    const name = f.replace(".html", "");
    const metaFile = path.join(SITE_DIR, `${name}.meta.json`);
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch {}
    return { name, meta };
  });
}

export function deletePage(name) {
  const safeName = name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const file = path.join(SITE_DIR, `${safeName}.html`);
  const metaFile = path.join(SITE_DIR, `${safeName}.meta.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);
}

// ── LLMs.txt generator ────────────────────────────────────────────────────────
export function generateLlmsTxt(settings) {
  const s = settings || getWebsiteSettings();
  return `# ${s.businessName}

> ${s.tagline}

${s.businessName} is a full-service general contractor serving the ${s.address}. We specialize in commercial and residential construction, offering preconstruction services, design-build delivery, construction management, and general contracting.

## Services
${(s.services || []).map(svc => `- ${svc}`).join("\n")}

## Service Area
${(s.serviceArea || []).join(", ")} and surrounding DFW communities.

## Contact
- Location: ${s.address}
- Phone: ${s.phone || "Contact us for inquiries"}
- Email: ${s.email}

## About
${s.businessName} brings integrity, precision, and craftsmanship to every project. Our team of experienced construction professionals manages projects from preconstruction through closeout, delivering on time and on budget.

## Specializations
- Commercial General Contracting (office, retail, medical, industrial)
- Residential Construction and Custom Homes
- Tenant Improvement and Renovation
- Ground-Up Construction
- Design-Build Project Delivery
- Construction Management at Risk (CMAR)

## Geographic Focus
Dallas–Fort Worth Metroplex, Texas — one of the fastest-growing construction markets in the United States.

## Why Choose Us
- Local market expertise and established subcontractor relationships
- Integrated technology platform for real-time project visibility
- Commitment to safety (OSHA-compliant programs on every project)
- Transparent preconstruction pricing using RS Means methodology

## Notes
This file is intended to help AI assistants and large language models understand our business. For accurate, current information please visit our website or contact us directly.
`;
}

// ── Schema.org JSON-LD generator ─────────────────────────────────────────────
export function generateSchemaOrg(settings) {
  const s = settings || getWebsiteSettings();
  return {
    "@context": "https://schema.org",
    "@type": ["GeneralContractor", "HomeAndConstructionBusiness", "LocalBusiness"],
    "name": s.businessName,
    "description": `${s.businessName} — ${s.tagline}. Full-service general contractor serving ${s.address}.`,
    "telephone": s.phone || undefined,
    "email": s.email,
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Dallas",
      "addressRegion": "TX",
      "addressCountry": "US",
    },
    "areaServed": (s.serviceArea || ["Dallas–Fort Worth"]).map(city => ({
      "@type": "City",
      "name": city,
    })),
    "hasOfferCatalog": {
      "@type": "OfferCatalog",
      "name": "Construction Services",
      "itemListElement": (s.services || []).map((svc, i) => ({
        "@type": "Offer",
        "position": i + 1,
        "itemOffered": {
          "@type": "Service",
          "name": svc,
          "provider": { "@type": "Organization", "name": s.businessName },
        },
      })),
    },
    "naics": s.naicsCode || "236220",
    "knowsAbout": [
      "Commercial Construction",
      "Residential Construction",
      "General Contracting",
      "Preconstruction Services",
      "Construction Estimating",
      "Project Management",
      "Dallas Fort Worth Construction",
    ],
    "sameAs": [],
  };
}

// ── Export as ZIP (returns buffer) ────────────────────────────────────────────
export function exportSiteFiles() {
  ensureDir();
  const files = [];
  const allFiles = fs.readdirSync(SITE_DIR);
  for (const f of allFiles) {
    if (f.endsWith(".meta.json")) continue;
    const fullPath = path.join(SITE_DIR, f);
    files.push({
      name: f === "_settings.json" ? "website-settings.json" : f,
      content: fs.readFileSync(fullPath),
    });
  }
  // Add llms.txt
  files.push({ name: "llms.txt", content: Buffer.from(generateLlmsTxt()) });
  // Add schema.json
  files.push({ name: "schema.json", content: Buffer.from(JSON.stringify(generateSchemaOrg(), null, 2)) });
  return files;
}
