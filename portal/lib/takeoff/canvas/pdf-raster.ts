export interface RasterizedPage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  scale: number;
  pageWidth: number;
  pageHeight: number;
}

/** Paint a sheet off the React thread. The caller falls back if the worker cannot start. */
export function rasterizePdfOffThread(url: string, containerWidth: number): Promise<RasterizedPage> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdf-raster.worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("PDF raster worker timed out"));
    }, 60_000);
    worker.onmessage = (event: MessageEvent<RasterizedPage>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("PDF raster worker failed"));
    };
    worker.postMessage({ url, containerWidth });
  });
}
