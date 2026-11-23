import * as ort from "onnxruntime-web";

// Configure .wasm files from CDN unpkg / jsdelivr
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
// Run WASM in ONNX Runtime Web's background Web Worker to keep main thread/UI responsive
ort.env.wasm.proxy = true;
// Single thread for rock-solid stability across mobile and desktop browsers without COOP/COEP
ort.env.wasm.numThreads = 1;

const MODEL_INPUT_SIZE = 512;
const DEFAULT_MODEL_URL =
  process.env.NEXT_PUBLIC_LAMA_MODEL_URL ||
  "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx";
const CACHE_NAME = "image-toolkit-ai-models-v1";

let cachedSession: ort.InferenceSession | null = null;

/**
 * Checks whether the LaMa model is already cached in browser Cache API.
 */
export async function isModelCached(
  modelUrl: string = DEFAULT_MODEL_URL,
): Promise<boolean> {
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const match = await cache.match(modelUrl);
      return !!match;
    } catch {
      return false;
    }
  }
  return false;
}

// ── Public progress interface ──────────────────────────────────────
export interface InpaintProgress {
  phase: "downloading" | "loading" | "preparing" | "inferring" | "compositing";
  message: string;
  percent?: number; // 0 – 100
  loadedMB?: number;
  totalMB?: number;
}

type ProgressCallback = (progress: InpaintProgress) => void;

// ── Model download with streaming progress ─────────────────────────
async function fetchModelBuffer(
  modelUrl: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Try Cache API first
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(modelUrl);

      if (cachedResponse) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        onProgress?.({
          phase: "downloading",
          message: "Loading AI model from device cache...",
          percent: 100,
        });
        return await cachedResponse.arrayBuffer();
      }

      onProgress?.({
        phase: "downloading",
        message: "Downloading AI model (one-time download)...",
        percent: 0,
        loadedMB: 0,
      });

      const response = await fetch(modelUrl, { signal });
      if (!response.ok) {
        throw new Error(`Failed to download AI model (HTTP ${response.status})`);
      }

      const contentLength = response.headers.get("Content-Length");
      const totalBytes = contentLength ? parseInt(contentLength, 10) : null;
      const totalMB = totalBytes ? +(totalBytes / (1024 * 1024)).toFixed(1) : undefined;

      // Stream download with progress
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;

        for (;;) {
          if (signal?.aborted) {
            await reader.cancel().catch(() => {});
            throw new DOMException("Aborted", "AbortError");
          }

          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;

          const loadedMB = +(loaded / (1024 * 1024)).toFixed(1);
          const percent = totalBytes ? Math.min(99, Math.round((loaded / totalBytes) * 100)) : undefined;

          onProgress?.({
            phase: "downloading",
            message: "Downloading AI model...",
            percent,
            loadedMB,
            totalMB,
          });
        }

        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        // Merge chunks into single buffer
        const merged = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }

        // Store in Cache API
        await cache.put(
          modelUrl,
          new Response(merged.buffer, {
            headers: { "Content-Type": "application/octet-stream" },
          }),
        );

        onProgress?.({
          phase: "downloading",
          message: "AI model downloaded successfully!",
          percent: 100,
          loadedMB: totalMB ?? +(loaded / (1024 * 1024)).toFixed(1),
          totalMB,
        });

        return merged.buffer;
      }

      // Fallback: no ReadableStream support
      const buf = await response.arrayBuffer();
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      await cache.put(modelUrl, new Response(buf, { headers: { "Content-Type": "application/octet-stream" } }));
      return buf;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      console.warn("Cache API warning, fallback to direct fetch:", err);
    }
  }

  // Final fallback (no Cache API)
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.({
    phase: "downloading",
    message: "Downloading AI model...",
    percent: 0,
  });
  const response = await fetch(modelUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to download AI model (HTTP ${response.status})`);
  }
  return await response.arrayBuffer();
}

// ── Session singleton ──────────────────────────────────────────────
async function getSession(
  modelUrl: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ort.InferenceSession> {
  if (cachedSession) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    onProgress?.({
      phase: "loading",
      message: "AI model is ready...",
      percent: 25,
    });
    return cachedSession;
  }

  const buffer = await fetchModelBuffer(modelUrl, onProgress, signal);

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.({
    phase: "loading",
    message: "Initializing AI engine...",
    percent: 25,
  });

  cachedSession = await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
  });

  return cachedSession;
}

// ── Bounding Box & ROI Type ────────────────────────────────────────
export type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  hasMask: boolean;
};

export type ROI = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Snaps mask pixels to canvas borders if they are within edgeSnapDistance (default: 6px).
 * Eliminates thin edge artifacts (e.g. 1-3px boundary lines) when brush strokes touch or near image edges.
 */
function snapMaskEdges(
  maskCanvas: HTMLCanvasElement,
  edgeSnapDistance: number = 6,
): void {
  const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let modified = false;

  const isPixelMasked = (x: number, y: number): boolean => {
    const idx = (y * w + x) * 4;
    return (
      data[idx + 3] > 10 &&
      (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10)
    );
  };

  const setPixelMasked = (x: number, y: number) => {
    const idx = (y * w + x) * 4;
    data[idx] = 255;
    data[idx + 1] = 255;
    data[idx + 2] = 255;
    data[idx + 3] = 255;
    modified = true;
  };

  // 1. Top & Bottom edges: iterate x across width
  for (let x = 0; x < w; x++) {
    // Check top edge (y from 0 up to edgeSnapDistance - 1)
    let topMaskedY = -1;
    for (let y = 0; y < Math.min(edgeSnapDistance, h); y++) {
      if (isPixelMasked(x, y)) {
        topMaskedY = y;
        break;
      }
    }
    if (topMaskedY > 0) {
      for (let y = 0; y < topMaskedY; y++) {
        setPixelMasked(x, y);
      }
    }

    // Check bottom edge (y from h - edgeSnapDistance to h - 1)
    let bottomMaskedY = -1;
    for (let y = h - 1; y >= Math.max(0, h - edgeSnapDistance); y--) {
      if (isPixelMasked(x, y)) {
        bottomMaskedY = y;
        break;
      }
    }
    if (bottomMaskedY !== -1 && bottomMaskedY < h - 1) {
      for (let y = bottomMaskedY + 1; y < h; y++) {
        setPixelMasked(x, y);
      }
    }
  }

  // 2. Left & Right edges: iterate y across height
  for (let y = 0; y < h; y++) {
    // Check left edge (x from 0 up to edgeSnapDistance - 1)
    let leftMaskedX = -1;
    for (let x = 0; x < Math.min(edgeSnapDistance, w); x++) {
      if (isPixelMasked(x, y)) {
        leftMaskedX = x;
        break;
      }
    }
    if (leftMaskedX > 0) {
      for (let x = 0; x < leftMaskedX; x++) {
        setPixelMasked(x, y);
      }
    }

    // Check right edge (x from w - edgeSnapDistance to w - 1)
    let rightMaskedX = -1;
    for (let x = w - 1; x >= Math.max(0, w - edgeSnapDistance); x--) {
      if (isPixelMasked(x, y)) {
        rightMaskedX = x;
        break;
      }
    }
    if (rightMaskedX !== -1 && rightMaskedX < w - 1) {
      for (let x = rightMaskedX + 1; x < w; x++) {
        setPixelMasked(x, y);
      }
    }
  }

  if (modified) {
    ctx.putImageData(imgData, 0, 0);
  }
}

function getMaskBoundingBox(
  maskCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
): BoundingBox {
  const mskData = maskCtx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isMasked =
        mskData[idx + 3] > 10 &&
        (mskData[idx] > 10 || mskData[idx + 1] > 10 || mskData[idx + 2] > 10);

      if (isMasked) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, hasMask: false };
  }

  return { minX, minY, maxX, maxY, hasMask: true };
}

// ── Cluster Bounding Box to Square-ish ROI ─────────────────────────
function bboxToSquareRoi(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  origW: number,
  origH: number,
): ROI {
  const maskW = Math.max(1, bbox.maxX - bbox.minX + 1);
  const maskH = Math.max(1, bbox.maxY - bbox.minY + 1);
  const centerX = bbox.minX + maskW / 2;
  const centerY = bbox.minY + maskH / 2;

  // Base size with generous padding (at least MODEL_INPUT_SIZE or 1.5x - 2x mask bounds)
  const paddedSize = Math.max(MODEL_INPUT_SIZE, Math.max(maskW, maskH) * 1.5);
  const maxPossible = Math.max(origW, origH);
  const roiSize = Math.max(1, Math.min(Math.round(paddedSize), maxPossible));

  let rx = Math.round(centerX - roiSize / 2);
  let ry = Math.round(centerY - roiSize / 2);

  // Clamp within image bounds
  if (rx < 0) rx = 0;
  if (ry < 0) ry = 0;
  if (rx + roiSize > origW) rx = Math.max(0, origW - roiSize);
  if (ry + roiSize > origH) ry = Math.max(0, origH - roiSize);

  const rw = Math.max(1, Math.min(roiSize, origW - rx));
  const rh = Math.max(1, Math.min(roiSize, origH - ry));

  return { x: rx, y: ry, w: rw, h: rh };
}

// Check whether two ROIs overlap
function doRoisOverlap(a: ROI, b: ROI): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

// Merge two ROIs
function mergeRois(a: ROI, b: ROI, origW: number, origH: number): ROI {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.w, b.x + b.w);
  const maxY = Math.max(a.y + a.h, b.y + b.h);

  return bboxToSquareRoi({ minX, minY, maxX, maxY }, origW, origH);
}

// ── Multi-Region / Connected Component Clustering ───────────────────
function getMaskClusters(
  maskCanvas: HTMLCanvasElement,
  origWidth: number,
  origHeight: number,
): ROI[] {
  const gridW = 128;
  const gridH = 128;

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = gridW;
  sampleCanvas.height = gridH;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) return [];

  // Draw mask onto 128x128 sampling canvas
  sampleCtx.drawImage(maskCanvas, 0, 0, gridW, gridH);
  const data = sampleCtx.getImageData(0, 0, gridW, gridH).data;

  const binaryGrid = new Uint8Array(gridW * gridH);
  for (let i = 0; i < gridW * gridH; i++) {
    const idx = i * 4;
    // Mask pixel check: alpha > 10 and has color value
    if (data[idx + 3] > 10 && (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10)) {
      binaryGrid[i] = 1;
    }
  }

  const visited = new Uint8Array(gridW * gridH);
  const rawClusters: { minX: number; minY: number; maxX: number; maxY: number }[] = [];

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const startIdx = y * gridW + x;
      if (binaryGrid[startIdx] === 1 && visited[startIdx] === 0) {
        let cMinX = x;
        let cMaxX = x;
        let cMinY = y;
        let cMaxY = y;

        const queue: number[] = [startIdx];
        visited[startIdx] = 1;

        while (queue.length > 0) {
          const curr = queue.pop()!;
          const cx = curr % gridW;
          const cy = Math.floor(curr / gridW);

          if (cx < cMinX) cMinX = cx;
          if (cx > cMaxX) cMaxX = cx;
          if (cy < cMinY) cMinY = cy;
          if (cy > cMaxY) cMaxY = cy;

          // 8-neighbor expansion
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                const nIdx = ny * gridW + nx;
                if (binaryGrid[nIdx] === 1 && visited[nIdx] === 0) {
                  visited[nIdx] = 1;
                  queue.push(nIdx);
                }
              }
            }
          }
        }

        rawClusters.push({ minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY });
      }
    }
  }

  if (rawClusters.length === 0) return [];

  // Convert grid coordinates back to original image coordinate scale
  const scaleX = origWidth / gridW;
  const scaleY = origHeight / gridH;

  const clusterRois: ROI[] = rawClusters.map((c) => {
    const minX = Math.max(0, Math.floor(c.minX * scaleX));
    const minY = Math.max(0, Math.floor(c.minY * scaleY));
    const maxX = Math.min(origWidth - 1, Math.ceil((c.maxX + 1) * scaleX));
    const maxY = Math.min(origHeight - 1, Math.ceil((c.maxY + 1) * scaleY));

    return bboxToSquareRoi({ minX, minY, maxX, maxY }, origWidth, origHeight);
  });

  // Merge overlapping ROIs
  const mergedList = [...clusterRois];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < mergedList.length; i++) {
      for (let j = i + 1; j < mergedList.length; j++) {
        if (doRoisOverlap(mergedList[i], mergedList[j])) {
          const merged = mergeRois(mergedList[i], mergedList[j], origWidth, origHeight);
          mergedList.splice(j, 1);
          mergedList[i] = merged;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return mergedList;
}

// ── 512×512 inference ──────────────────────────────────────────────
async function runInferenceOnCanvas(
  session: ort.InferenceSession,
  roiImgCanvas: HTMLCanvasElement,
  roiMaskCanvas: HTMLCanvasElement,
  onProgress?: ProgressCallback,
): Promise<HTMLCanvasElement> {
  // 1. Resize ROI to 512x512 for model tensor input
  const imgCanvas512 = document.createElement("canvas");
  imgCanvas512.width = MODEL_INPUT_SIZE;
  imgCanvas512.height = MODEL_INPUT_SIZE;
  const imgCtx512 = imgCanvas512.getContext("2d");
  if (!imgCtx512) throw new Error("Failed to initialize image tensor canvas.");

  imgCtx512.drawImage(roiImgCanvas, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const imgData = imgCtx512.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;

  const mskCanvas512 = document.createElement("canvas");
  mskCanvas512.width = MODEL_INPUT_SIZE;
  mskCanvas512.height = MODEL_INPUT_SIZE;
  const mskCtx512 = mskCanvas512.getContext("2d");
  if (!mskCtx512) throw new Error("Failed to initialize mask tensor canvas.");

  mskCtx512.drawImage(roiMaskCanvas, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const mskData = mskCtx512.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;

  // 2. Convert to Float32 Tensor: image [1, 3, 512, 512] (0..1) & mask [1, 1, 512, 512] (0 or 1)
  const totalPixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const imageFloat = new Float32Array(3 * totalPixels);
  const rawMaskBinary = new Uint8Array(totalPixels);

  let activeMaskPixels = 0;
  for (let i = 0; i < totalPixels; i++) {
    const rgbaIdx = i * 4;
    imageFloat[i] = imgData[rgbaIdx] / 255.0; // R
    imageFloat[totalPixels + i] = imgData[rgbaIdx + 1] / 255.0; // G
    imageFloat[2 * totalPixels + i] = imgData[rgbaIdx + 2] / 255.0; // B

    const isMasked =
      mskData[rgbaIdx + 3] > 10 &&
      (mskData[rgbaIdx] > 10 ||
        mskData[rgbaIdx + 1] > 10 ||
        mskData[rgbaIdx + 2] > 10);
    if (isMasked) {
      rawMaskBinary[i] = 1;
      activeMaskPixels++;
    }
  }

  // If no mask pixels present in this ROI, return input image directly
  if (activeMaskPixels === 0) {
    return imgCanvas512;
  }

  // Apply 2-3px dilation to binary mask so edges are completely inpainted
  const dilatedMaskFloat = new Float32Array(totalPixels);
  const dilationRadius = 2;

  for (let y = 0; y < MODEL_INPUT_SIZE; y++) {
    for (let x = 0; x < MODEL_INPUT_SIZE; x++) {
      const idx = y * MODEL_INPUT_SIZE + x;
      if (rawMaskBinary[idx] === 1) {
        for (let dy = -dilationRadius; dy <= dilationRadius; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= MODEL_INPUT_SIZE) continue;
          for (let dx = -dilationRadius; dx <= dilationRadius; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= MODEL_INPUT_SIZE) continue;
            dilatedMaskFloat[ny * MODEL_INPUT_SIZE + nx] = 1.0;
          }
        }
      }
    }
  }

  const imageTensor = new ort.Tensor("float32", imageFloat, [
    1,
    3,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]);
  const maskTensor = new ort.Tensor("float32", dilatedMaskFloat, [
    1,
    1,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]);

  // 3. Run AI inference
  onProgress?.({
    phase: "inferring",
    message: "Removing object with AI...",
    percent: 75,
  });

  // Yield control with double requestAnimationFrame + timeout for smooth UI repaint
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 120);
      });
    });
  });

  const feeds: Record<string, ort.Tensor> = {
    [session.inputNames[0]]: imageTensor,
    [session.inputNames[1]]: maskTensor,
  };
  const results = await session.run(feeds);
  const outputTensor = results[session.outputNames[0]];
  const outData = outputTensor.data as Float32Array;

  // Auto-detect dynamic range (0..1 vs 0..255)
  let maxVal = 0;
  const sampleLimit = Math.min(outData.length, 5000);
  for (let i = 0; i < sampleLimit; i++) {
    if (outData[i] > maxVal) maxVal = outData[i];
  }
  const scale = maxVal <= 1.5 ? 255.0 : 1.0;

  // 4. Convert output tensor back to 512x512 Canvas
  const outCanvas512 = document.createElement("canvas");
  outCanvas512.width = MODEL_INPUT_SIZE;
  outCanvas512.height = MODEL_INPUT_SIZE;
  const outCtx512 = outCanvas512.getContext("2d");
  if (!outCtx512) throw new Error("Failed to initialize inpainting output canvas.");

  const outImageData = outCtx512.createImageData(
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  );

  for (let i = 0; i < totalPixels; i++) {
    const rgbaIdx = i * 4;
    outImageData.data[rgbaIdx] = Math.min(
      255,
      Math.max(0, Math.round(outData[i] * scale)),
    );
    outImageData.data[rgbaIdx + 1] = Math.min(
      255,
      Math.max(0, Math.round(outData[totalPixels + i] * scale)),
    );
    outImageData.data[rgbaIdx + 2] = Math.min(
      255,
      Math.max(0, Math.round(outData[2 * totalPixels + i] * scale)),
    );
    outImageData.data[rgbaIdx + 3] = 255;
  }
  outCtx512.putImageData(outImageData, 0, 0);

  return outCanvas512;
}

// ── Inpaint one cluster ROI safely ──────────────────────────────────
async function inpaintClusterRoi(
  session: ort.InferenceSession,
  workingCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  roi: ROI,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const { x: rx, y: ry, w: rw, h: rh } = roi;

  // 1. Crop image from workingCanvas at (rx, ry, rw, rh)
  const roiImgCanvas = document.createElement("canvas");
  roiImgCanvas.width = rw;
  roiImgCanvas.height = rh;
  const roiImgCtx = roiImgCanvas.getContext("2d");
  if (!roiImgCtx) throw new Error("Failed to create image ROI canvas.");
  roiImgCtx.drawImage(workingCanvas, rx, ry, rw, rh, 0, 0, rw, rh);

  // 2. Crop mask from maskCanvas at identical coordinates (rx, ry, rw, rh)
  const roiMaskCanvas = document.createElement("canvas");
  roiMaskCanvas.width = rw;
  roiMaskCanvas.height = rh;
  const roiMaskCtx = roiMaskCanvas.getContext("2d");
  if (!roiMaskCtx) throw new Error("Failed to create mask ROI canvas.");
  roiMaskCtx.drawImage(maskCanvas, rx, ry, rw, rh, 0, 0, rw, rh);

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // 3. Run 512x512 inference
  const out512Canvas = await runInferenceOnCanvas(session, roiImgCanvas, roiMaskCanvas, onProgress);

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.({
    phase: "compositing",
    message: "Perfecting high-resolution details...",
    percent: 95,
  });

  // 4. Compositing for patch (rw x rh):
  // Create patchAlphaMask from mask (mask pixels = rgba(255,255,255,255), outer = rgba(0,0,0,0))
  const patchAlphaMask = document.createElement("canvas");
  patchAlphaMask.width = rw;
  patchAlphaMask.height = rh;
  const patchAlphaCtx = patchAlphaMask.getContext("2d");
  if (!patchAlphaCtx) throw new Error("Failed to create patch alpha mask context.");

  const rawRoiMaskData = roiMaskCtx.getImageData(0, 0, rw, rh);
  const alphaMaskImageData = patchAlphaCtx.createImageData(rw, rh);
  const totalRoiPixels = rw * rh;

  for (let i = 0; i < totalRoiPixels; i++) {
    const idx = i * 4;
    const isMasked =
      rawRoiMaskData.data[idx + 3] > 10 &&
      (rawRoiMaskData.data[idx] > 10 ||
        rawRoiMaskData.data[idx + 1] > 10 ||
        rawRoiMaskData.data[idx + 2] > 10);

    if (isMasked) {
      alphaMaskImageData.data[idx] = 255;
      alphaMaskImageData.data[idx + 1] = 255;
      alphaMaskImageData.data[idx + 2] = 255;
      alphaMaskImageData.data[idx + 3] = 255;
    } else {
      alphaMaskImageData.data[idx] = 0;
      alphaMaskImageData.data[idx + 1] = 0;
      alphaMaskImageData.data[idx + 2] = 0;
      alphaMaskImageData.data[idx + 3] = 0;
    }
  }
  patchAlphaCtx.putImageData(alphaMaskImageData, 0, 0);

  // Smooth feathering on alpha mask (2px blur)
  const featheredMaskCanvas = document.createElement("canvas");
  featheredMaskCanvas.width = rw;
  featheredMaskCanvas.height = rh;
  const featheredMaskCtx = featheredMaskCanvas.getContext("2d");
  if (!featheredMaskCtx) throw new Error("Failed to create feathered mask context.");

  featheredMaskCtx.filter = "blur(2px)";
  featheredMaskCtx.drawImage(patchAlphaMask, 0, 0);

  // Create patchResult: draw featheredMaskCanvas, source-in out512Canvas scaled to (rw x rh)
  const patchResult = document.createElement("canvas");
  patchResult.width = rw;
  patchResult.height = rh;
  const patchResultCtx = patchResult.getContext("2d");
  if (!patchResultCtx) throw new Error("Failed to create patch result context.");

  patchResultCtx.drawImage(featheredMaskCanvas, 0, 0);
  patchResultCtx.globalCompositeOperation = "source-in";
  patchResultCtx.imageSmoothingEnabled = true;
  patchResultCtx.imageSmoothingQuality = "high";
  patchResultCtx.drawImage(out512Canvas, 0, 0, rw, rh);

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Composite patchResult directly onto workingCanvas at (rx, ry)
  const workingCtx = workingCanvas.getContext("2d");
  if (!workingCtx) throw new Error("Failed to access working canvas context.");
  workingCtx.drawImage(patchResult, rx, ry);
}

// ── Main export ────────────────────────────────────────────────────
export async function runLamaInpaint(
  originalCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  onProgress?: ProgressCallback,
  outputMimeType: string = "image/png",
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const modelUrl = DEFAULT_MODEL_URL;
  const session = await getSession(modelUrl, onProgress, signal);

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const origWidth = originalCanvas.width;
  const origHeight = originalCanvas.height;

  // 0. Pre-process mask: snap near-edge mask pixels directly to outer borders
  snapMaskEdges(maskCanvas, 6);

  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Failed to access mask context.");

  // 1. Validate mask presence
  const globalBbox = getMaskBoundingBox(maskCtx, origWidth, origHeight);
  if (!globalBbox.hasMask) {
    throw new Error("No masked area selected.");
  }

  onProgress?.({
    phase: "preparing",
    message: "Preparing high-resolution area...",
    percent: 45,
  });

  // 2. Initialize workingCanvas once with originalCanvas
  const workingCanvas = document.createElement("canvas");
  workingCanvas.width = origWidth;
  workingCanvas.height = origHeight;
  const workingCtx = workingCanvas.getContext("2d");
  if (!workingCtx) throw new Error("Failed to create working canvas.");
  workingCtx.drawImage(originalCanvas, 0, 0);

  // 3. Detect stroke clusters
  const detectedClusters = getMaskClusters(maskCanvas, origWidth, origHeight);
  const clusterRois =
    detectedClusters.length > 0
      ? detectedClusters
      : [bboxToSquareRoi(globalBbox, origWidth, origHeight)];

  console.debug(
    `[LaMa Inpaint] Found ${clusterRois.length} ROI cluster(s):`,
    clusterRois.map((r, i) => `Cluster ${i + 1}: [x=${r.x}, y=${r.y}, w=${r.w}, h=${r.h}]`),
  );

  // 4. Sequential execution for each cluster ROI
  for (let i = 0; i < clusterRois.length; i++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const roi = clusterRois[i];
    if (clusterRois.length > 1) {
      onProgress?.({
        phase: "preparing",
        message: `Preparing area ${i + 1} of ${clusterRois.length}...`,
        percent: Math.round(45 + (i / clusterRois.length) * 20),
      });

      await new Promise((r) => setTimeout(r, 50));
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    await inpaintClusterRoi(
      session,
      workingCanvas,
      maskCanvas,
      roi,
      onProgress,
      signal,
    );
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const quality = outputMimeType === "image/png" ? undefined : 0.92;
  return workingCanvas.toDataURL(outputMimeType, quality);
}
