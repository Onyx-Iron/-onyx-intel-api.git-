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


class CenterlineBody(BaseModel):
    points: list[tuple[float, float]]
    half_width: float
    obstacles: list[list[tuple[float, float]]] = Field(default_factory=list)


class UnionBody(BaseModel):
    rings: list[list[tuple[float, float]]]


class TransformBody(BaseModel):
    points: list[tuple[float, float]]
    source_epsg: int
    target_epsg: int = 2276


class GeoreferenceBody(BaseModel):
    sheet_a: tuple[float, float]
    sheet_b: tuple[float, float]
    world_a: tuple[float, float]
    world_b: tuple[float, float]
    points: list[tuple[float, float]] = Field(default_factory=list)
    epsg: int = 2276


class TerrainBody(BaseModel):
    existing: list[tuple[float, float, float]]
    proposed: list[tuple[float, float, float]]
    units: str = "ft"
    boundary: list[tuple[float, float]] = Field(default_factory=list)


class ContourBody(BaseModel):
    contours: list[dict] = Field(default_factory=list)
    spots: list[dict] = Field(default_factory=list)


class TrenchBody(BaseModel):
    centerline: list[tuple[float, float]]
    width_ft: float
    depth_ft: float
    bedding_ft: float = 0


class CutFillCell(BaseModel):
    x: float = 0
    y: float = 0
    existing_z: float = 0
    proposed_z: float = 0


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
    alternates: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    cut_fill: list[CutFillCell] = Field(default_factory=list)


class ScheduleRowsBody(BaseModel):
    rows: list[list] = Field(default_factory=list)


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

    @router.post("/api/geometry/centerline")
    def geometry_centerline(body: CenterlineBody) -> dict:
        from services.geometry_service import buffer_centerline

        try:
            return buffer_centerline(body.points, body.half_width, body.obstacles)
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

    @router.post("/api/cad/georeference")
    def cad_georeference(body: GeoreferenceBody) -> dict:
        from services.cad_service import apply_sheet_transform, fit_sheet_transform

        try:
            transform = fit_sheet_transform(body.sheet_a, body.sheet_b, body.world_a, body.world_b)
            projected = apply_sheet_transform(body.points, transform) if body.points else []
        except ValueError as exc:
            raise _service_error(exc) from exc
        return {"transform": transform, "points": projected, "epsg": body.epsg}

    @router.post("/api/terrain/cut-fill")
    def terrain_cut_fill(body: TerrainBody) -> dict:
        from services.terrain_service import cut_fill_tin

        try:
            return cut_fill_tin(body.existing, body.proposed, body.units, body.boundary or None)
        except ValueError as exc:
            raise _service_error(exc) from exc

    @router.post("/api/terrain/contours")
    def terrain_contours(body: ContourBody) -> dict:
        from services.terrain_service import contours_to_points

        return {"points": contours_to_points(body.contours, body.spots)}

    @router.post("/api/terrain/trench")
    def terrain_trench(body: TrenchBody) -> dict:
        from services.terrain_service import trench_volume

        try:
            return trench_volume(body.centerline, body.width_ft, body.depth_ft, body.bedding_ft)
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

    @router.post("/api/vision/count-classes")
    async def vision_classes(
        page: UploadFile = File(...),
        templates: list[UploadFile] = File(...),
        names: str = "",
        threshold: float = 0.8,
    ) -> dict:
        from services.vision_service import count_classes, decode_image

        labels = [part.strip() for part in names.split(",") if part.strip()]
        try:
            sheet = decode_image(await page.read())
            named = {}
            for index, upload in enumerate(templates):
                label = labels[index] if index < len(labels) else (upload.filename or f"class-{index + 1}")
                named[label] = decode_image(await upload.read())
            return count_classes(sheet, named, threshold)
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
            [cell.model_dump() for cell in body.cut_fill] or None,
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
            body.alternates,
            body.exclusions,
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

    @router.post("/api/ocr/schedule-lines")
    def ocr_schedule_lines(body: ScheduleRowsBody) -> dict:
        from services.ocr_service import schedule_rows_to_lines

        return {"lines": schedule_rows_to_lines(body.rows)}

    return router
