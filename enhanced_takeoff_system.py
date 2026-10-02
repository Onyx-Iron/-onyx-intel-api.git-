"""
Onyx Intel — ENHANCED Takeoff System
Combines your superior validation/extraction with OpenConstructionERP's cost database
+ advanced features (AI fallback, multi-format support, real-time streaming)
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, AsyncGenerator
from enum import Enum

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ════════════════════════════════════════════════════════════════════════════
# ENHANCED ROW SCHEMA — Your validation + OpenConstructionERP cost database
# ════════════════════════════════════════════════════════════════════════════

class EnhancedTakeoffRow(BaseModel):
    """
    Your SecureTakeoffRow + Historical Cost Data
    
    KEEPS YOUR DESIGN:
    ✓ Strict validation (no hallucinations)
    ✓ CSI MasterFormat codes
    ✓ Quantity basis (auditable)
    ✓ Drawing references
    
    ADDS OpenConstructionERP ideas:
    ✓ Historical cost lookup (regional)
    ✓ Assembly breakdown (labor/material/equipment split)
    ✓ Waste factors by trade
    ✓ Supplier recommendations
    """
    model_config = {"extra": "ignore"}
    
    # YOUR CORE SCHEMA (KEEP AS-IS)
    id: str = Field(default_factory=lambda: str(__import__('uuid').uuid4()))
    trade: str = Field(..., min_length=2, max_length=120)
    cost_code: str = Field(..., pattern=r"^\d{2}-\d{2}-\d{2}$")
    description: str = Field(..., min_length=5, max_length=500)
    quantity_basis: str = Field(..., min_length=1, max_length=250)
    total_qty: float = Field(..., ge=0)  # negative quantities are a data-entry error, not a "credit"
    uom: str = Field(..., min_length=1, max_length=5)
    drawing_ref: str = Field(default="", max_length=50)
    location_tag: str = Field(default="", max_length=120)

    # NEW: Enhanced cost fields (from OpenConstructionERP)
    estimated_unit_cost: float = Field(default=0.0, ge=0)
    estimated_line_total: float = Field(default=0.0, ge=0)

    # Cost breakdown (labor, material, equipment)
    labor_pct: float = Field(default=0.40, ge=0, le=1)  # 40% labor default
    material_pct: float = Field(default=0.45, ge=0, le=1)  # 45% material
    equipment_pct: float = Field(default=0.15, ge=0, le=1)  # 15% equipment

    # Waste factor & regional adjustment — bounded to a sane real-world range so a
    # malformed/adversarial payload can't arbitrarily inflate or deflate line totals
    waste_factor: float = Field(default=1.0, ge=1.0, le=2.0)  # 1.0 = no waste, 1.15 = 15% waste
    regional_multiplier: float = Field(default=1.0, gt=0, le=5.0)  # Cost adjustment by region

    # Source metadata for traceability
    source_database: str = Field(default="onyx-intel")  # "onyx-intel", "oce", "rs-means", etc.
    last_cost_update: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    

class CostDatabaseReference(BaseModel):
    """Link to historical cost data (like OpenConstructionERP's 42 cost catalogues)."""
    trade: str
    cost_code: str
    description: str
    region: str  # US_EAST, US_WEST, US_MIDWEST, INTERNATIONAL
    base_unit_cost: float
    labor_cost: float
    material_cost: float
    equipment_cost: float
    supplier_id: str | None = None
    last_updated: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ════════════════════════════════════════════════════════════════════════════
# YOUR VALIDATION ENGINE (ENHANCED but still YOURS)
# ════════════════════════════════════════════════════════════════════════════

class BreachType(str, Enum):
    ROW_COUNT_MISMATCH = "ROW_COUNT_MISMATCH"
    QUANTITY_SUM_MISMATCH = "QUANTITY_SUM_MISMATCH"
    TOTAL_PARSE_FAILURE = "TOTAL_PARSE_FAILURE"
    MALFORMED_JSON = "MALFORMED_JSON"
    SOURCE_NOT_ARRAY = "SOURCE_NOT_ARRAY"
    COST_LOOKUP_FAILED = "COST_LOOKUP_FAILED"  # NEW


class DataIntegrityBreachException(Exception):
    """Your exception, now with cost lookup tracking."""
    
    def __init__(
        self,
        breach_type: BreachType,
        message: str,
        details: dict[str, Any] = None,
    ):
        self.breach_type = breach_type
        self.message = message
        self.details = details or {}
        super().__init__(f"[{breach_type.value}] {message}")


class EnhancedDeterministicParser:
    """
    YOUR PARSER + Cost Enrichment
    
    1. Parse & validate (YOUR ALGORITHM - unchanged)
    2. Look up costs from regional database
    3. Calculate line totals with waste factors
    4. Return both validated rows AND cost breakdown
    """
    
    def __init__(self, raw_json_payload: str, cost_db: CostDatabase = None):
        self._raw = raw_json_payload
        self._cost_db = cost_db or CostDatabase()
        self._validated: list[EnhancedTakeoffRow] = []
        self._errors: list[dict] = []
    
    def execute_with_cost_enrichment(
        self,
        region: str = "US_EAST",
    ) -> tuple[list[EnhancedTakeoffRow], dict[str, Any]]:
        """
        Parse, validate, AND enrich with cost data.
        
        Returns:
            (validated_rows, summary)
            summary = {
                "total_qty": float,
                "estimated_cost": float,
                "cost_breakdown": {"labor": float, "material": float, "equipment": float},
                "regional_adjustment": float,
                "waste_factor_avg": float,
                "errors": list[dict],
                "audit_report": dict
            }
        """
        
        # Step 1: YOUR VALIDATION ALGORITHM (unchanged)
        logger.info("Step 1: Parse & validate rows")
        parsed = self._parse_json_or_breach()
        source_checksum = self._capture_source_checksum(parsed)
        
        for index, raw_row in enumerate(parsed):
            self._validate_single_row_enhanced(index, raw_row, region)
        
        # Step 2: Enrich with cost data (NEW)
        logger.info("Step 2: Enrich with cost data")
        total_estimated = 0.0
        labor_total = 0.0
        material_total = 0.0
        equipment_total = 0.0
        rows_missing_cost: list[dict[str, str]] = []

        for row in self._validated:
            # Look up historical cost
            cost_record = self._cost_db.lookup(
                trade=row.trade,
                cost_code=row.cost_code,
                description=row.description,
                region=region,
            )

            if cost_record:
                # Calculate line total
                base_cost = cost_record.base_unit_cost * row.total_qty
                adjusted_cost = base_cost * row.waste_factor * row.regional_multiplier

                row.estimated_unit_cost = cost_record.base_unit_cost
                row.estimated_line_total = adjusted_cost

                split = (
                    cost_record.labor_cost
                    + cost_record.material_cost
                    + cost_record.equipment_cost
                )
                if split > 0:
                    row.labor_pct = cost_record.labor_cost / split
                    row.material_pct = cost_record.material_cost / split
                    row.equipment_pct = cost_record.equipment_cost / split
                else:
                    # Unit price only. Book it as material; do not invent a split.
                    row.labor_pct = 0.0
                    row.material_pct = 1.0
                    row.equipment_pct = 0.0

                labor_total += adjusted_cost * row.labor_pct
                material_total += adjusted_cost * row.material_pct
                equipment_total += adjusted_cost * row.equipment_pct

                total_estimated += adjusted_cost
            else:
                # No cost match — the row is silently excluded from total_estimated
                # below, which would otherwise understate the project total with no
                # visible signal. Surface it explicitly instead of only logging.
                logger.warning(
                    "No cost match for row %s (%s / %s) — excluded from estimated_cost",
                    row.id, row.trade, row.cost_code,
                )
                rows_missing_cost.append({
                    "row_id": row.id,
                    "trade": row.trade,
                    "cost_code": row.cost_code,
                    "description": row.description[:120],
                })

        # Step 3: Assemble summary
        summary = {
            "total_rows": len(self._validated),
            "total_qty": sum(r.total_qty for r in self._validated),
            "estimated_cost": round(total_estimated, 2),
            "cost_breakdown": {
                "labor": round(labor_total, 2),
                "material": round(material_total, 2),
                "equipment": round(equipment_total, 2),
            },
            "region": region,
            "regional_adjustment": self._validated[0].regional_multiplier if self._validated else 1.0,
            "waste_factor_avg": sum(r.waste_factor for r in self._validated) / len(self._validated) if self._validated else 1.0,
            "errors": len(self._errors),
            "source_checksum": source_checksum.model_dump() if hasattr(source_checksum, 'model_dump') else {},
            "validation_passed": len(self._errors) == 0,
            "rows_missing_cost": rows_missing_cost,
            "cost_coverage_incomplete": len(rows_missing_cost) > 0,
        }

        return self._validated, summary
    
    def _parse_json_or_breach(self) -> list[dict[str, Any]]:
        """YOUR ALGORITHM - exactly as-is"""
        try:
            parsed = json.loads(self._raw)
        except json.JSONDecodeError as exc:
            raise DataIntegrityBreachException(
                breach_type=BreachType.MALFORMED_JSON,
                message=f"Invalid JSON: {exc}",
                details={"position": exc.pos},
            )
        
        if not isinstance(parsed, list):
            raise DataIntegrityBreachException(
                breach_type=BreachType.SOURCE_NOT_ARRAY,
                message="Payload must be a JSON array",
                details={"actual_type": type(parsed).__name__},
            )
        
        return parsed
    
    def _capture_source_checksum(self, parsed: list[Any]) -> dict:
        """YOUR ALGORITHM - unchanged"""
        qty_sum = sum(
            float(row.get("total_qty", 0) or 0)
            for row in parsed if isinstance(row, dict)
        )
        
        canonical = json.dumps(parsed, sort_keys=True, ensure_ascii=False)
        raw_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        
        return {
            "row_count": len(parsed),
            "qty_sum": round(qty_sum, 3),
            "raw_hash": raw_hash[:16],
        }
    
    def _validate_single_row_enhanced(self, index: int, raw_row: Any, region: str) -> None:
        """YOUR VALIDATION LOGIC + cost enrichment"""
        if not isinstance(raw_row, dict):
            self._errors.append({
                "row_index": index,
                "error": "Row is not a JSON object",
                "raw_value": str(raw_row)[:100],
            })
            return
        
        try:
            # Create your EnhancedTakeoffRow (inherits your SecureTakeoffRow validation)
            row = EnhancedTakeoffRow(**raw_row)
            
            # Apply regional multiplier
            region_multiplier = self._get_regional_multiplier(region)
            row.regional_multiplier = region_multiplier
            
            self._validated.append(row)
        except Exception as exc:
            self._errors.append({
                "row_index": index,
                "error": str(exc)[:200],
                "raw_row": {k: str(v)[:50] for k, v in raw_row.items()},
            })
    
    def _get_regional_multiplier(self, region: str) -> float:
        """Get cost adjustment multiplier by region (like OpenConstructionERP)."""
        multipliers = {
            "US_WEST": 1.15,      # California, expensive
            "US_MIDWEST": 0.95,   # Cheaper labor/materials
            "US_SOUTH": 0.98,
            "US_EAST": 1.0,       # Baseline
            "INTERNATIONAL": 1.2,
        }
        return multipliers.get(region, 1.0)


# ════════════════════════════════════════════════════════════════════════════
# COST DATABASE (Like OpenConstructionERP's 42 catalogues, but yours)
# ════════════════════════════════════════════════════════════════════════════

class CostDatabase:
    """
    Cost reference catalog.

    Two modes:
      • "supabase" — calls the portal's /api/cost-catalog/v2 with tenant_id,
                     zip, and state to resolve location-aware unit costs from
                     Supabase. Default when env vars are set.
      • "sample"   — small in-memory sample for tests + local dev.

    All constructor params are optional so existing callers like
    `CostDatabase()` keep working; tenant/state/zip can also be passed at
    `lookup()` time (overrides per-call).
    """

    def __init__(
        self,
        tenant_id: str | None = None,
        state_code: str | None = None,
        zip_code: str | None = None,
        mode: str | None = None,
    ):
        self.tenant_id = tenant_id
        self.state_code = state_code
        self.zip_code = zip_code

        if mode is None:
            try:
                from cost_supabase import is_configured as _is_configured
                mode = "supabase" if _is_configured() else "sample"
            except Exception:
                mode = "sample"
        self.mode = mode

        # Sample cache always built — used as fallback if Supabase returns nothing
        self._sample_cache: dict[str, CostDatabaseReference] = self._build_sample_costs()

    def lookup(
        self,
        trade: str,
        cost_code: str,
        description: str,
        region: str = "US_EAST",
        tenant_id: str | None = None,
        state_code: str | None = None,
        zip_code: str | None = None,
    ) -> CostDatabaseReference | None:
        """Look up unit cost for a takeoff line.

        Per-call tenant/state/zip override the values passed to the constructor.
        """
        effective_tenant = tenant_id or self.tenant_id
        effective_state = state_code or self.state_code
        effective_zip = zip_code or self.zip_code

        if self.mode == "supabase":
            try:
                from cost_supabase import resolve_unit_cost
                result = resolve_unit_cost(
                    csi_code=cost_code,
                    tenant_id=effective_tenant,
                    zip_code=effective_zip,
                    state_code=effective_state,
                )
            except Exception as exc:  # pragma: no cover — network / import failure
                logger.warning("Supabase cost lookup failed for %s: %s", cost_code, exc)
                result = None

            if result:
                ref = CostDatabaseReference(
                    trade=result.get("trade") or trade,
                    cost_code=result.get("csi_code") or cost_code,
                    description=result.get("description") or description,
                    region=result.get("region") or region,
                    base_unit_cost=float(result["base_unit_cost"]),
                    labor_cost=float(result.get("labor_cost") or 0.0),
                    material_cost=float(result.get("material_cost") or 0.0),
                    equipment_cost=float(result.get("equipment_cost") or 0.0),
                    supplier_id=result.get("supplier_id"),
                    last_updated=result.get("last_updated") or datetime.now(timezone.utc).isoformat(),
                )
                # Attach confidence + source as attributes (outside pydantic model_config="ignore")
                try:
                    object.__setattr__(ref, "_meta", {
                        "confidence": result.get("confidence", 0.8),
                        "source_database": result.get("source_database", "supabase"),
                    })
                except Exception:
                    pass
                return ref
            # fall through to sample fallback when Supabase has no entry

        # "sample" mode (or supabase miss)
        key = f"{cost_code}_{region}".lower()
        if key in self._sample_cache:
            return self._sample_cache[key]
        if region != "US_EAST":
            base_key = f"{cost_code}_US_EAST".lower()
            if base_key in self._sample_cache:
                return self._sample_cache[base_key]

        logger.warning("No cost data for %s (%s) in %s", cost_code, trade, region)
        return None
    
    def _build_sample_costs(self) -> dict[str, CostDatabaseReference]:
        """Sample cost database — fallback when Supabase is unreachable / unset."""
        
        sample_costs = [
            # Concrete (Division 03)
            CostDatabaseReference(
                trade="Concrete",
                cost_code="03-30-00",
                description="Concrete, cast-in-place",
                region="US_EAST",
                base_unit_cost=325.0,  # $ per CY
                labor_cost=150.0,
                material_cost=140.0,
                equipment_cost=35.0,
            ),
            # Structural Steel (Division 05)
            CostDatabaseReference(
                trade="Structural Steel",
                cost_code="05-12-00",
                description="Steel beam, W-section",
                region="US_EAST",
                base_unit_cost=0.85,  # $ per LB
                labor_cost=0.35,
                material_cost=0.42,
                equipment_cost=0.08,
            ),
            # Drywall (Division 09)
            CostDatabaseReference(
                trade="Drywall",
                cost_code="09-21-00",
                description="Drywall, GWB, 5/8\"",
                region="US_EAST",
                base_unit_cost=2.50,  # $ per SF
                labor_cost=1.10,
                material_cost=1.15,
                equipment_cost=0.25,
            ),
            # Electrical (Division 26)
            CostDatabaseReference(
                trade="Electrical",
                cost_code="26-05-33",
                description="Electrical conduit, EMT",
                region="US_EAST",
                base_unit_cost=4.20,  # $ per LF
                labor_cost=2.10,
                material_cost=1.80,
                equipment_cost=0.30,
            ),
            # Plumbing — codes the extractor emits
            CostDatabaseReference(
                trade="Plumbing",
                cost_code="22-11-16",
                description="Domestic water piping, copper",
                region="US_EAST",
                base_unit_cost=48.00,  # $ per LF
                labor_cost=22.00,
                material_cost=24.00,
                equipment_cost=2.00,
            ),
            CostDatabaseReference(
                trade="Plumbing",
                cost_code="22-13-16",
                description="Sanitary waste piping",
                region="US_EAST",
                base_unit_cost=36.00,  # $ per LF
                labor_cost=18.00,
                material_cost=16.00,
                equipment_cost=2.00,
            ),
            # HVAC
            CostDatabaseReference(
                trade="HVAC",
                cost_code="23-31-13",
                description="Sheet metal ductwork",
                region="US_EAST",
                base_unit_cost=12.50,  # $ per SF
                labor_cost=6.00,
                material_cost=5.50,
                equipment_cost=1.00,
            ),
            CostDatabaseReference(
                trade="HVAC",
                cost_code="23-23-00",
                description="Refrigerant piping",
                region="US_EAST",
                base_unit_cost=42.00,  # $ per LF
                labor_cost=20.00,
                material_cost=19.00,
                equipment_cost=3.00,
            ),
            CostDatabaseReference(
                trade="Electrical",
                cost_code="26-24-16",
                description="Panelboard",
                region="US_EAST",
                base_unit_cost=1850.00,  # $ per EA
                labor_cost=650.00,
                material_cost=1100.00,
                equipment_cost=100.00,
            ),
            CostDatabaseReference(
                trade="Fire Alarm",
                cost_code="28-31-00",
                description="Fire alarm device",
                region="US_EAST",
                base_unit_cost=285.00,  # $ per EA
                labor_cost=120.00,
                material_cost=155.00,
                equipment_cost=10.00,
            ),
            CostDatabaseReference(
                trade="Utilities",
                cost_code="33-40-00",
                description="Storm drainage utility",
                region="US_EAST",
                base_unit_cost=72.00,  # $ per LF
                labor_cost=28.00,
                material_cost=38.00,
                equipment_cost=6.00,
            ),
            # TxDOT-mapped civil codes
            CostDatabaseReference(
                trade="Earthwork",
                cost_code="31-23-23",
                description="Flexible base",
                region="US_EAST",
                base_unit_cost=41.20,  # $ per CY
                labor_cost=12.00,
                material_cost=22.20,
                equipment_cost=7.00,
            ),
            CostDatabaseReference(
                trade="Paving",
                cost_code="32-12-16",
                description="Hot mix asphalt",
                region="US_EAST",
                base_unit_cost=98.10,  # $ per TON
                labor_cost=18.00,
                material_cost=68.10,
                equipment_cost=12.00,
            ),
            CostDatabaseReference(
                trade="Earthwork",
                cost_code="31-37-00",
                description="Riprap",
                region="US_EAST",
                base_unit_cost=134.50,  # $ per CY
                labor_cost=40.00,
                material_cost=74.50,
                equipment_cost=20.00,
            ),
            CostDatabaseReference(
                trade="Utilities",
                cost_code="33-41-00",
                description="Reinforced concrete pipe",
                region="US_EAST",
                base_unit_cost=82.40,  # $ per LF
                labor_cost=24.00,
                material_cost=50.40,
                equipment_cost=8.00,
            ),
        ]
        
        # Index by cost_code_region
        cache = {}
        for cost in sample_costs:
            key = f"{cost.cost_code}_{cost.region}".lower()
            cache[key] = cost
        
        return cache


# ════════════════════════════════════════════════════════════════════════════
# REAL-TIME STREAMING (Enhanced from your existing code)
# ════════════════════════════════════════════════════════════════════════════

class EnhancedStreamingParser:
    """Stream validated + cost-enriched rows in real-time (your design + OpenConstructionERP cost lookup)."""
    
    def __init__(self, file_path: str, cost_db: CostDatabase = None):
        self.file_path = file_path
        self.cost_db = cost_db or CostDatabase()
    
    async def stream_with_costs(
        self,
        chunk_size: int = 15,
        region: str = "US_EAST",
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Stream parsed + cost-enriched rows as they're validated.
        
        Emits NDJSON events:
        {
            "event": "ROW_VALIDATED",
            "row": {...EnhancedTakeoffRow...},
            "cost": {"unit": 325.0, "line_total": 9750.0},
            "summary": {...}
        }
        """
        
        import json as _json
        from pathlib import Path
        
        # Load and parse your file
        ext = Path(self.file_path).suffix.lower()
        
        if ext == ".json":
            with open(self.file_path, "r") as f:
                raw_json = f.read()
        else:
            # Non-JSON blueprint (PDF / DXF / IFC / XLSX): run through the
            # deterministic extractor and serialise the row list into JSON so
            # `EnhancedDeterministicParser` treats it exactly like a hand-authored
            # takeoff.  Previously this branch silently produced `{}` which meant
            # every non-JSON upload came back with zero rows and no cost data.
            from takeoff_extract import extract as _takeoff_extract
            extracted = _takeoff_extract(self.file_path)
            rows = extracted.get("rows", []) if isinstance(extracted, dict) else (extracted or [])
            raw_json = json.dumps(rows)
        
        # Create enhanced parser
        parser = EnhancedDeterministicParser(raw_json, self.cost_db)
        rows, summary = parser.execute_with_cost_enrichment(region=region)
        
        # Stream rows in chunks
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i:i+chunk_size]
            
            for row in chunk:
                event = {
                    "event": "ROW_VALIDATED",
                    "row": row.model_dump(),
                    "cost": {
                        "unit_cost": row.estimated_unit_cost,
                        "line_total": row.estimated_line_total,
                        "waste_factor": row.waste_factor,
                    },
                }
                
                yield _json.dumps(event, default=str) + "\n"
        
        # Send summary
        summary_event = {
            "event": "SUMMARY",
            **summary,
        }
        yield _json.dumps(summary_event, default=str) + "\n"


# ════════════════════════════════════════════════════════════════════════════
# USAGE EXAMPLE
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Sample takeoff data
    sample_takeoff = [
        {
            "trade": "Concrete",
            "cost_code": "03-30-00",
            "description": "Concrete, cast-in-place for foundation slab",
            "quantity_basis": "Calculated from floor plan dimensions: 50ft x 40ft x 0.5ft deep",
            "total_qty": 37.0,  # cubic yards
            "uom": "CY",
            "drawing_ref": "Foundation Plan A-101",
            "location_tag": "Foundation",
        },
        {
            "trade": "Structural Steel",
            "cost_code": "05-12-00",
            "description": "Structural steel beams, W12x50",
            "quantity_basis": "8 beams @ 40ft each, per structural drawing S-201",
            "total_qty": 320.0,  # linear feet
            "uom": "LF",
            "drawing_ref": "Structural Plan S-201",
            "location_tag": "Main Frame",
        },
        {
            "trade": "Drywall",
            "cost_code": "09-21-00",
            "description": "Interior drywall, 5/8 inch fire-rated",
            "quantity_basis": "Interior wall area: 5000 SF per architectural plan",
            "total_qty": 5000.0,  # square feet
            "uom": "SF",
            "drawing_ref": "Interior Elevations A-301",
            "location_tag": "Interior Walls",
        },
    ]
    
    # Parse and enrich
    raw_json = json.dumps(sample_takeoff)
    cost_db = CostDatabase()
    parser = EnhancedDeterministicParser(raw_json, cost_db)
    
    rows, summary = parser.execute_with_cost_enrichment(region="US_EAST")
    
    print("\n=== VALIDATED + COST-ENRICHED TAKEOFF ===\n")
    print(f"Total Rows: {summary['total_rows']}")
    print(f"Total Qty: {summary['total_qty']}")
    print(f"Estimated Cost: ${summary['estimated_cost']:,.2f}")
    print(f"\nCost Breakdown:")
    for key, val in summary['cost_breakdown'].items():
        print(f"  {key.title()}: ${val:,.2f}")
    
    print(f"\nValidation Errors: {summary['errors']}")
    print(f"Region: {summary['region']}")

