import { processPaintByNumber } from "../engine/pipeline";
import type { Settings } from "../engine/types";

type Incoming = {
  image: { data: Uint8ClampedArray; width: number; height: number };
  settings: Settings;
};

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

worker.onmessage = (event: MessageEvent<Incoming>) => {
  try {
    const { image, settings } = event.data;
    const result = processPaintByNumber(image, settings, (update) => {
      worker.postMessage({ type: "progress", ...update });
    });
    worker.postMessage({ type: "result", result }, [result.indices.buffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    worker.postMessage({ type: "error", message });
  }
};
