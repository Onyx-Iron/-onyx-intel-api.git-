"""HTTP routes for the geometry engine. Mounted by takeoff_api."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field


class RingBody(BaseModel):
    outer: list[tuple[float, float]]
    holes: list[list[tuple[float, float]]] = Field(default_factory=list)


class OffsetBody(BaseModel):
    ring: list[tuple[float, float]]
    distance: float


class UnionBody(BaseModel):
    rings: list[list[tuple[float, float]]]


class TransformBody(BaseModel):
    points: list[tuple[float, float]]
    source_epsg: int
    target_epsg: int = 2276


class TerrainBody(BaseModel):
    existing: list[tuple[float, float, float]]
    proposed: list[tuple[float, float, float]]
    units: str = "ft"


class EstimateLine(BaseModel):
    cost_code: str = ""
    description: str = ""
    quantity: float = 0
    unit: str = ""
    labor_unit: float = 0
    material_unit: float = 0
    equipment_unit: float = 0
    subcontractor_unit: float = 0
    trucking_unit: float = 0
    disposal_unit: float = 0


class EstimateExportBody(BaseModel):
    project_name: str = "Project"
    company_name: str = "Onyx Intel"
    contingency_pct: float = 0
    overhead_pct: float = 0
    profit_pct: float = 0
    rows: list[EstimateLine] = Field(default_factory=list)


def _service_error(exc: Exception) -> HTTPException:
    status = 422 if isinstance(exc, ValueError) else 503
    return HTTPException(status_code=status, detail=str(exc))


def build_router(verify_secret) -> APIRouter:
    router = APIRouter(dependencies=[Depends(verify_secret)])

    @router.post("/api/geometry/net-area")
    def geometry_net_area(body: RingBody) -> dict:
        from services.geometry_service import net_area

        try:
            area = net_area(body.outer, body.holes)
        except ValueError as exc:
            raise _service_error(exc) from exc
        return {"area": area}

    @router.post("/api/geometry/offset")
    def geometry_offset(body: OffsetBody) -> dict:
        from services.geometry_service import offset_ring

        try:
            return offset_ring(body.ring, body.distance)
        except ValueError as exc:
            raise _service_error(exc) from exc

    @router.post("/api/geometry/union-area")
    def geometry_union(body: UnionBody) -> dict:
        from services.geometry_service import union_area

        return {"area": union_area(body.rings)}

    @router.post("/api/cad/to-canvas")
    def cad_to_canvas(body: TransformBody) -> dict:
        from services.cad_service import to_canvas_feet

        try:
            points = to_canvas_feet(body.points, body.source_epsg, body.target_epsg)
        except Exception as exc:  # pyproj raises CRSError for an unknown code
            raise _service_error(ValueError(str(exc))) from exc
        return {"points": points, "target_epsg": body.target_epsg}

    @router.post("/api/terrain/cut-fill")
    def terrain_cut_fill(body: TerrainBody) -> dict:
        from services.terrain_service import cut_fill_tin

        try:
            return cut_fill_tin(body.existing, body.proposed, body.units)
        except ValueError as exc:
            raise _service_error(exc) from exc

    @router.post("/api/vision/count-template")
    async def vision_count(
        page: UploadFile = File(...),
        template: UploadFile = File(...),
        threshold: float = 0.8,
    ) -> dict:
        from services.vision_service import count_template, decode_image

        try:
            sheet = decode_image(await page.read())
            symbol = decode_image(await template.read())
            return count_template(sheet, symbol, threshold)
        except ValueError as exc:
            raise _service_error(exc) from exc

    @router.post("/api/export/estimate.xlsx")
    def export_estimate(body: EstimateExportBody) -> Response:
        from services.excel_service import build_estimate_workbook

        payload = build_estimate_workbook(
            [row.model_dump() for row in body.rows],
            {
                "contingency_pct": body.contingency_pct,
                "overhead_pct": body.overhead_pct,
                "profit_pct": body.profit_pct,
            },
            body.project_name,
        )
        return Response(
            content=payload,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="estimate.xlsx"'},
        )

    @router.post("/api/export/proposal.pdf")
    def export_proposal(body: EstimateExportBody) -> Response:
        from services.proposal_service import build_proposal_pdf

        payload = build_proposal_pdf(
            [row.model_dump() for row in body.rows],
            {
                "contingency_pct": body.contingency_pct,
                "overhead_pct": body.overhead_pct,
                "profit_pct": body.profit_pct,
            },
            body.project_name,
            body.company_name,
        )
        return Response(content=payload, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="proposal.pdf"'})

    @router.post("/api/ocr/schedule-tables")
    async def ocr_tables(file: UploadFile = File(...)) -> dict:
        from services.ocr_service import extract_schedule_tables

        suffix = Path(file.filename or "sheet.pdf").suffix or ".pdf"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            handle.write(await file.read())
            path = handle.name
        try:
            return {"tables": extract_schedule_tables(path)}
        finally:
            Path(path).unlink(missing_ok=True)

    return router
