import { extractVectorsFromOperatorList } from "./pdf-vector-extract";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (data: unknown) => void;
};

scope.onmessage = (event: MessageEvent) => {
  scope.postMessage(extractVectorsFromOperatorList(event.data));
};
