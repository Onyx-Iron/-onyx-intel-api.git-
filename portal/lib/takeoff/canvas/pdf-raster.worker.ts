/// <reference lib="webworker" />

import * as pdfjs from "pdfjs-dist";

import { sheetRenderScale } from "./sheet-bitmap-cache";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface RasterRequest {
  url: string;
  containerWidth: number;
}

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<RasterRequest>) => {
  const { url, containerWidth } = event.data;
  const doc = await pdfjs.getDocument({ url }).promise;
  const page = await doc.getPage(1);
  const viewport1 = page.getViewport({ scale: 1 });
  const scale = sheetRenderScale(containerWidth, viewport1.width);
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas has no 2d context");
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const bitmap = canvas.transferToImageBitmap();
  scope.postMessage(
    {
      width: canvas.width,
      height: canvas.height,
      scale,
      pageWidth: viewport1.width,
      pageHeight: viewport1.height,
      bitmap,
    },
    [bitmap],
  );
  await doc.destroy();
};
