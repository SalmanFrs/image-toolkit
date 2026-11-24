import * as ort from "onnxruntime-web";

// Configure .wasm files from CDN jsdelivr
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
// Run WASM in ONNX Runtime Web's background Web Worker to keep main thread/UI responsive
ort.env.wasm.proxy = true;
// Single thread for rock-solid stability across mobile and desktop browsers without COOP/COEP
ort.env.wasm.numThreads = 1;

export const DEFAULT_UPSCALER_MODEL_URL =
  process.env.NEXT_PUBLIC_UPSCALER_MODEL_URL ||
  "https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx";

const CACHE_NAME = "image-toolkit-ai-models-v1";
const MAX_FALLBACK_DIMENSION = 2048;
const TILE_SIZE = 256;
const TILE_OVERLAP = 16;
const NATIVE_MODEL_SCALE = 4;

let cachedSession: ort.InferenceSession | null = null;

export interface UpscaleProgress {
  phase: "downloading" | "loading" | "preparing" | "inferring" | "compositing";
  message: string;
  percent?: number; // 0 - 100
  loadedMB?: number;
  totalMB?: number;
}

export type UpscaleProgressCallback = (progress: UpscaleProgress) => void;

export interface UpscaleOptions {
  scale?: 2 | 4;
  preset?: "photo" | "illustration";
  quality?: number; // 0.1 to 1.0 (for lossy outputs)
  modelUrl?: string;
  onProgress?: UpscaleProgressCallback;
  signal?: AbortSignal;
}

/**
 * Checks whether the Super-Resolution model is already cached in browser Cache API.
 */
export async function isUpscalerModelCached(
  modelUrl: string = DEFAULT_UPSCALER_MODEL_URL,
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

// ── Model download with streaming progress ─────────────────────────
async function fetchModelBuffer(
  modelUrl: string,
  onProgress?: UpscaleProgressCallback,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

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
          message: "Loading Super-Resolution AI model from cache...",
          percent: 100,
        });
        return await cachedResponse.arrayBuffer();
      }

      onProgress?.({
        phase: "downloading",
        message: "Downloading Super-Resolution AI model...",
        percent: 0,
        loadedMB: 0,
      });

      const response = await fetch(modelUrl, { signal });
      if (!response.ok) {
        throw new Error(
          `Failed to download Super-Resolution model (HTTP ${response.status})`,
        );
      }

      const contentLength = response.headers.get("Content-Length");
      const totalBytes = contentLength ? parseInt(contentLength, 10) : null;
      const totalMB = totalBytes
        ? +(totalBytes / (1024 * 1024)).toFixed(1)
        : undefined;

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
          const percent = totalBytes
            ? Math.min(99, Math.round((loaded / totalBytes) * 100))
            : undefined;

          onProgress?.({
            phase: "downloading",
            message: "Downloading Super-Resolution AI model...",
            percent,
            loadedMB,
            totalMB,
          });
        }

        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const merged = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }

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

      const buf = await response.arrayBuffer();
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      await cache.put(
        modelUrl,
        new Response(buf, {
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
      return buf;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      console.warn("Cache API warning, fallback to direct fetch:", err);
    }
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.({
    phase: "downloading",
    message: "Downloading Super-Resolution AI model...",
    percent: 0,
  });
  const response = await fetch(modelUrl, { signal });
  if (!response.ok) {
    throw new Error(
      `Failed to download Super-Resolution model (HTTP ${response.status})`,
    );
  }
  return await response.arrayBuffer();
}

// ── Session singleton ──────────────────────────────────────────────
async function getUpscalerSession(
  modelUrl: string,
  onProgress?: UpscaleProgressCallback,
  signal?: AbortSignal,
): Promise<ort.InferenceSession> {
  if (cachedSession) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    onProgress?.({
      phase: "loading",
      message: "AI upscaler model is ready...",
      percent: 20,
    });
    return cachedSession;
  }

  const buffer = await fetchModelBuffer(modelUrl, onProgress, signal);

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.({
    phase: "loading",
    message: "Initializing AI upscaler engine...",
    percent: 25,
  });

  cachedSession = await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
  });

  return cachedSession;
}

// ── Yield to UI event loop ─────────────────────────────────────────
async function yieldControl(delayMs: number = 0): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

// ── Unsharp Mask filter for sharpening ─────────────────────────────
function applyUnsharpMask(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount: number = 0.35,
): void {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Clone original buffer
  const original = new Uint8ClampedArray(data);

  // 3x3 gaussian-like blur approximation
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;

      for (let c = 0; c < 3; c++) {
        const top = ((y - 1) * width + x) * 4 + c;
        const bottom = ((y + 1) * width + x) * 4 + c;
        const left = (y * width + (x - 1)) * 4 + c;
        const right = (y * width + (x + 1)) * 4 + c;
        const center = idx + c;

        const blurred =
          (original[top] +
            original[bottom] +
            original[left] +
            original[right] +
            original[center] * 4) /
          8;

        const val = original[center] + (original[center] - blurred) * amount;
        data[idx + c] = Math.max(0, Math.min(255, val));
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// ── High Quality Canvas Upscaling (Fallback for ultra-large images) ─
async function canvasSuperSampleFallback(
  inputCanvas: HTMLCanvasElement,
  targetScale: number,
  preset: "photo" | "illustration",
  onProgress?: UpscaleProgressCallback,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  onProgress?.({
    phase: "preparing",
    message: "Ultra-large image detected. Using progressive multi-step scaling...",
    percent: 30,
  });

  const outWidth = Math.round(inputCanvas.width * targetScale);
  const outHeight = Math.round(inputCanvas.height * targetScale);

  // Progressive 2-step upscale to retain maximum edge sharpness
  let currentCanvas = inputCanvas;
  const steps = targetScale === 4 ? [2, targetScale] : [targetScale];

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const stepScale = steps[i];
    const sw = Math.round(inputCanvas.width * stepScale);
    const sh = Math.round(inputCanvas.height * stepScale);

    const stepCanvas = document.createElement("canvas");
    stepCanvas.width = sw;
    stepCanvas.height = sh;
    const sCtx = stepCanvas.getContext("2d");
    if (!sCtx) throw new Error("Canvas context is unavailable.");

    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = "high";
    sCtx.drawImage(currentCanvas, 0, 0, sw, sh);

    currentCanvas = stepCanvas;
    await yieldControl(30);

    onProgress?.({
      phase: "inferring",
      message: `Scaling image (${i + 1}/${steps.length})...`,
      percent: Math.round(40 + ((i + 1) / steps.length) * 45),
    });
  }

  onProgress?.({
    phase: "compositing",
    message: "Applying texture & edge enhancement...",
    percent: 92,
  });

  const finalCtx = currentCanvas.getContext("2d");
  if (finalCtx) {
    const sharpenAmount = preset === "photo" ? 0.35 : 0.22;
    applyUnsharpMask(finalCtx, outWidth, outHeight, sharpenAmount);
  }

  onProgress?.({
    phase: "compositing",
    message: "High-resolution rendering complete!",
    percent: 100,
  });

  return currentCanvas;
}

// ── Single Tile Inference ──────────────────────────────────────────
async function runTileInference(
  session: ort.InferenceSession,
  tileCanvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<{ data: Float32Array; width: number; height: number }> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const tw = tileCanvas.width;
  const th = tileCanvas.height;
  const tileCtx = tileCanvas.getContext("2d", { willReadFrequently: true });
  if (!tileCtx) throw new Error("Tile canvas context is unavailable.");

  const imgData = tileCtx.getImageData(0, 0, tw, th);
  const data = imgData.data;
  const totalPixels = tw * th;

  // Convert RGBA to Float32 CHW normalized [0..1]
  const inputFloat = new Float32Array(3 * totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const rgbaIdx = i * 4;
    inputFloat[i] = data[rgbaIdx] / 255.0; // R
    inputFloat[totalPixels + i] = data[rgbaIdx + 1] / 255.0; // G
    inputFloat[2 * totalPixels + i] = data[rgbaIdx + 2] / 255.0; // B
  }

  const inputTensor = new ort.Tensor("float32", inputFloat, [1, 3, th, tw]);
  const inputName = session.inputNames[0] || "input";

  const feeds: Record<string, ort.Tensor> = {
    [inputName]: inputTensor,
  };

  const results = await session.run(feeds);
  const outputName = session.outputNames[0];
  const outputTensor = results[outputName];

  if (!outputTensor) {
    throw new Error("AI upscaler produced no output tensor.");
  }

  // Model outputs 4x resolution: [1, 3, th * 4, tw * 4]
  const outW = tw * NATIVE_MODEL_SCALE;
  const outH = th * NATIVE_MODEL_SCALE;
  const outData = outputTensor.data as Float32Array;

  return {
    data: outData,
    width: outW,
    height: outH,
  };
}

// ── Tiled Super-Resolution Inference ───────────────────────────────
async function runTiledUpscale(
  session: ort.InferenceSession,
  inputCanvas: HTMLCanvasElement,
  onProgress?: UpscaleProgressCallback,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  const inW = inputCanvas.width;
  const inH = inputCanvas.height;
  const outW = inW * NATIVE_MODEL_SCALE;
  const outH = inH * NATIVE_MODEL_SCALE;
  const totalOutPixels = outW * outH;

  // Weighted Accumulation Buffers to completely prevent dark grid lines / alpha seams
  const accumR = new Float32Array(totalOutPixels);
  const accumG = new Float32Array(totalOutPixels);
  const accumB = new Float32Array(totalOutPixels);
  const accumW = new Float32Array(totalOutPixels);

  const stepX = TILE_SIZE - TILE_OVERLAP;
  const stepY = TILE_SIZE - TILE_OVERLAP;

  // Calculate tiles grid
  type TileInfo = {
    x: number;
    y: number;
    w: number;
    h: number;
    isLeft: boolean;
    isRight: boolean;
    isTop: boolean;
    isBottom: boolean;
  };

  const tiles: TileInfo[] = [];

  for (let y = 0; y < inH; y += stepY) {
    for (let x = 0; x < inW; x += stepX) {
      const w = Math.min(TILE_SIZE, inW - x);
      const h = Math.min(TILE_SIZE, inH - y);

      tiles.push({
        x,
        y,
        w,
        h,
        isLeft: x === 0,
        isRight: x + w >= inW,
        isTop: y === 0,
        isBottom: y + h >= inH,
      });
    }
  }

  const totalTiles = tiles.length;

  for (let idx = 0; idx < totalTiles; idx++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const t = tiles[idx];

    // Crop input tile
    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = t.w;
    tileCanvas.height = t.h;
    const tileCtx = tileCanvas.getContext("2d");
    if (!tileCtx) throw new Error("Failed to crop tile context.");

    tileCtx.drawImage(inputCanvas, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);

    onProgress?.({
      phase: "inferring",
      message: `Enhancing details (Tile ${idx + 1} of ${totalTiles})...`,
      percent: Math.round(30 + ((idx + 1) / totalTiles) * 55),
    });

    const upscaled = await runTileInference(session, tileCanvas, signal);
    const tileWOut = upscaled.width;
    const tileHOut = upscaled.height;
    const tilePixels = tileWOut * tileHOut;
    const tileData = upscaled.data;

    const startOutX = t.x * NATIVE_MODEL_SCALE;
    const startOutY = t.y * NATIVE_MODEL_SCALE;
    const overlapOut = TILE_OVERLAP * NATIVE_MODEL_SCALE;

    // Accumulate each pixel with linear boundary weight feathering
    for (let py = 0; py < tileHOut; py++) {
      const globalY = startOutY + py;
      if (globalY >= outH) continue;

      let weightY = 1.0;
      if (!t.isTop && py < overlapOut) {
        weightY = Math.max(0.01, py / overlapOut);
      }
      if (!t.isBottom && py >= tileHOut - overlapOut) {
        weightY = Math.max(0.01, (tileHOut - 1 - py) / overlapOut);
      }

      for (let px = 0; px < tileWOut; px++) {
        const globalX = startOutX + px;
        if (globalX >= outW) continue;

        let weightX = 1.0;
        if (!t.isLeft && px < overlapOut) {
          weightX = Math.max(0.01, px / overlapOut);
        }
        if (!t.isRight && px >= tileWOut - overlapOut) {
          weightX = Math.max(0.01, (tileWOut - 1 - px) / overlapOut);
        }

        const weight = Math.max(0.01, weightX * weightY);
        const tileIdx = py * tileWOut + px;
        const globalIdx = globalY * outW + globalX;

        const r = tileData[tileIdx] * 255.0;
        const g = tileData[tilePixels + tileIdx] * 255.0;
        const b = tileData[2 * tilePixels + tileIdx] * 255.0;

        accumR[globalIdx] += r * weight;
        accumG[globalIdx] += g * weight;
        accumB[globalIdx] += b * weight;
        accumW[globalIdx] += weight;
      }
    }

    // Allow UI thread to repaint smoothly
    await yieldControl(20);
  }

  // Construct final composite canvas from accumulation buffers
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outW;
  outputCanvas.height = outH;
  const outCtx = outputCanvas.getContext("2d");
  if (!outCtx) throw new Error("Failed to create output canvas context.");

  const finalImageData = outCtx.createImageData(outW, outH);
  const outRgba = finalImageData.data;

  for (let i = 0; i < totalOutPixels; i++) {
    const w = accumW[i] || 1.0;
    const r = Math.max(0, Math.min(255, Math.round(accumR[i] / w)));
    const g = Math.max(0, Math.min(255, Math.round(accumG[i] / w)));
    const b = Math.max(0, Math.min(255, Math.round(accumB[i] / w)));

    const rgbaIdx = i * 4;
    outRgba[rgbaIdx] = r;
    outRgba[rgbaIdx + 1] = g;
    outRgba[rgbaIdx + 2] = b;
    outRgba[rgbaIdx + 3] = 255;
  }

  outCtx.putImageData(finalImageData, 0, 0);
  return outputCanvas;
}

// ── Main Upscaling Function ────────────────────────────────────────
/**
 * Upscales an image using client-side AI Super-Resolution (Real-ESRGAN Compact ONNX)
 * with automatic browser caching, tiled inference, overlap feathering, and high-dimension fallback.
 *
 * @param source Image source: HTMLImageElement, HTMLCanvasElement, or ImageBitmap
 * @param options Upscale options (scale: 2|4, preset: "photo"|"illustration", onProgress, signal)
 * @param outputMimeType Target output format ("image/png", "image/jpeg", "image/webp")
 * @returns Data URL string of the upscaled image
 */
export async function runImageUpscaler(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  options: UpscaleOptions = {},
  outputMimeType: string = "image/png",
): Promise<string> {
  const {
    scale = 4,
    preset = "photo",
    quality = 0.92,
    modelUrl = DEFAULT_UPSCALER_MODEL_URL,
    onProgress,
    signal,
  } = options;

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // 1. Prepare input canvas
  onProgress?.({
    phase: "preparing",
    message: "Analyzing image dimensions...",
    percent: 5,
  });

  const sw = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sh = "naturalHeight" in source ? source.naturalHeight : source.height;

  if (!sw || !sh) {
    throw new Error("Invalid image source dimensions.");
  }

  const inputCanvas = document.createElement("canvas");
  inputCanvas.width = sw;
  inputCanvas.height = sh;
  const inputCtx = inputCanvas.getContext("2d", { willReadFrequently: true });
  if (!inputCtx) {
    throw new Error("Unable to create canvas context for source image.");
  }

  // If JPG export, fill with clean background
  if (outputMimeType === "image/jpeg") {
    inputCtx.fillStyle = "#ffffff";
    inputCtx.fillRect(0, 0, sw, sh);
  }
  inputCtx.drawImage(source, 0, 0);

  // 2. High Dimension Safeguard: Auto fallback for ultra-large images (>2048px)
  const maxDimension = Math.max(sw, sh);
  let finalCanvas: HTMLCanvasElement;

  if (maxDimension > MAX_FALLBACK_DIMENSION) {
    finalCanvas = await canvasSuperSampleFallback(
      inputCanvas,
      scale,
      preset,
      onProgress,
      signal,
    );
  } else {
    // 3. AI Tiled Super-Resolution Inference
    const session = await getUpscalerSession(modelUrl, onProgress, signal);

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    onProgress?.({
      phase: "inferring",
      message: "Processing image with AI Super-Resolution...",
      percent: 30,
    });

    // Run native 4x tiled AI inference
    const raw4xCanvas = await runTiledUpscale(
      session,
      inputCanvas,
      onProgress,
      signal,
    );

    onProgress?.({
      phase: "compositing",
      message: "Refining visual clarity and texture...",
      percent: 90,
    });

    if (scale === 2) {
      // Downscale native 4x AI result cleanly to 2x using high-quality bicubic canvas scaling
      const canvas2x = document.createElement("canvas");
      canvas2x.width = Math.round(sw * 2);
      canvas2x.height = Math.round(sh * 2);
      const ctx2x = canvas2x.getContext("2d");
      if (!ctx2x) throw new Error("Failed to create 2x canvas context.");

      ctx2x.imageSmoothingEnabled = true;
      ctx2x.imageSmoothingQuality = "high";
      ctx2x.drawImage(raw4xCanvas, 0, 0, canvas2x.width, canvas2x.height);

      const sharpenAmount = preset === "photo" ? 0.25 : 0.15;
      applyUnsharpMask(ctx2x, canvas2x.width, canvas2x.height, sharpenAmount);

      finalCanvas = canvas2x;
    } else {
      // Native 4x: apply subtle preset enhancement
      const finalCtx = raw4xCanvas.getContext("2d");
      if (finalCtx) {
        const sharpenAmount = preset === "photo" ? 0.3 : 0.18;
        applyUnsharpMask(finalCtx, raw4xCanvas.width, raw4xCanvas.height, sharpenAmount);
      }
      finalCanvas = raw4xCanvas;
    }
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  onProgress?.({
    phase: "compositing",
    message: "Super-Resolution complete!",
    percent: 100,
  });

  return finalCanvas.toDataURL(outputMimeType, quality);
}
