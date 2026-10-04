import { NextRequest, NextResponse } from "next/server";
import { projectContext } from "@/lib/project-file/api";

export const runtime = "nodejs";

const WEATHER: Record<number, string> = {
  0: "Clear",
  1: "Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Overcast",
  48: "Overcast",
  51: "Rain",
  61: "Rain",
  63: "Rain",
  65: "Rain",
  71: "Snow",
  73: "Snow",
  75: "Snow",
  80: "Rain",
  95: "Rain",
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const gate = await projectContext(id);
  if (!gate.ok) return gate.response;
  const { data: project, error } = await gate.ctx.db
    .from("projects")
    .select("latitude, longitude")
    .eq("id", gate.projectId)
    .eq("tenant_id", gate.ctx.tenantId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (project.latitude == null || project.longitude == null) {
    return NextResponse.json({ weather: null, temperature: null, reason: "Project has no coordinates" });
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${project.latitude}&longitude=${project.longitude}&current=temperature_2m,weather_code`;
  try {
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ weather: null, temperature: null });
    const json = await res.json() as { current?: { temperature_2m?: number; weather_code?: number } };
    const code = json.current?.weather_code;
    return NextResponse.json({
      weather: code == null ? null : (WEATHER[code] ?? "Overcast"),
      temperature: json.current?.temperature_2m == null ? null : String(Math.round(json.current.temperature_2m)),
    });
  } catch {
    return NextResponse.json({ weather: null, temperature: null });
  }
}
