import { notFound } from "next/navigation";
import EstimateMatrix from "@/components/estimate/EstimateMatrix";

export default function EstimateE2EPage() {
  if (process.env.PLAYWRIGHT_TEST_MODE !== "1") notFound();
  return <EstimateMatrix projectId="project-e2e" projectName="E2E Project" />;
}
