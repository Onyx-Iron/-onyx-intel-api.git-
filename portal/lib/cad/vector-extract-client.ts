import { extractVectorsFromOperatorList, type ExtractedVector, type VectorExtractInput } from "./pdf-vector-extract";

/** Run the operator walk off the UI thread. Falls back to the caller if a worker cannot start. */
export function extractVectorsOffMainThread(input: VectorExtractInput): Promise<ExtractedVector[]> {
  if (typeof Worker === "undefined") return Promise.resolve(extractVectorsFromOperatorList(input));
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./vector-extract.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(extractVectorsFromOperatorList(input));
      return;
    }
    const finish = (vectors: ExtractedVector[]) => {
      worker.terminate();
      resolve(vectors);
    };
    worker.onmessage = (event: MessageEvent<ExtractedVector[]>) => finish(event.data);
    worker.onerror = () => finish(extractVectorsFromOperatorList(input));
    try {
      worker.postMessage(input);
    } catch {
      finish(extractVectorsFromOperatorList(input));
    }
  });
}
