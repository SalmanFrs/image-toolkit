"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runLamaInpaint } from "../lib/lamaInpaint";
import type { InpaintProgress } from "../lib/lamaInpaint";

type Point = {
  x: number;
  y: number;
};

type Stroke = {
  points: Point[];
  size: number;
};

type EditorMode = "remove";

type ImageEditorProps = {
  imageUrl: string;
  mode: EditorMode;
};

const MAX_PREVIEW_SIZE = 1600;

// ── Phase stepper config ───────────────────────────────────────────
const PHASE_STEPS: {
  key: InpaintProgress["phase"];
  label: string;
}[] = [
  { key: "downloading", label: "Download" },
  { key: "loading", label: "Load AI" },
  { key: "preparing", label: "Prepare" },
  { key: "inferring", label: "Infer" },
  { key: "compositing", label: "Compose" },
];

export default function ImageEditor({ imageUrl, mode }: ImageEditorProps) {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);
  const comparisonContainerRef = useRef<HTMLDivElement>(null);
  const draggingComparisonRef = useRef(false);

  const [brushSize, setBrushSize] = useState(40);
  const [strokeCount, setStrokeCount] = useState(0);
  const [imageSize, setImageSize] = useState({
    width: 0,
    height: 0,
  });
  const [imageError, setImageError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<InpaintProgress | null>(null);
  const [processingError, setProcessingError] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState<
    "slider" | "side-by-side"
  >("slider");
  const [comparisonPosition, setComparisonPosition] = useState(50);

  useEffect(() => {
    setResultUrl(null);
    setProcessingError("");
  }, [mode]);

  useEffect(() => {
    return () => {
      if (resultUrl) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [resultUrl]);

  const brushSizeRef = useRef(brushSize);

  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);

  const redrawOverlay = useCallback((strokes: Stroke[]) => {
    const overlay = overlayCanvasRef.current;
    const mask = maskCanvasRef.current;

    if (!overlay || !mask) return;

    const overlayCtx = overlay.getContext("2d");
    const maskCtx = mask.getContext("2d");

    if (!overlayCtx || !maskCtx) return;

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    maskCtx.fillStyle = "#000000";
    maskCtx.fillRect(0, 0, mask.width, mask.height);

    for (const stroke of strokes) {
      const first = stroke.points[0];

      if (!first) continue;

      const drawStroke = (ctx: CanvasRenderingContext2D, color: string) => {
        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = stroke.size;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        if (stroke.points.length === 1) {
          ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
          ctx.fill();
          return;
        }

        ctx.moveTo(first.x, first.y);

        for (let i = 1; i < stroke.points.length; i++) {
          const point = stroke.points[i];

          if (point) {
            ctx.lineTo(point.x, point.y);
          }
        }

        ctx.stroke();
      };

      drawStroke(overlayCtx, "rgba(239, 68, 68, 0.5)");
      drawStroke(maskCtx, "#ffffff");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();

    // Reset data in the asynchronous image-loading callbacks.
    strokesRef.current = [];
    currentStrokeRef.current = null;
    drawingRef.current = false;

    image.onload = () => {
      const imageCanvas = imageCanvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;

      if (!imageCanvas || !overlayCanvas || !maskCanvas) {
        setImageError("Editor canvas is unavailable. Please reload the page.");
        setIsLoading(false);
        return;
      }

      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;

      if (!naturalWidth || !naturalHeight) {
        setImageError("The selected image has invalid dimensions.");
        setIsLoading(false);
        return;
      }

      // Keep the preview lightweight for high-resolution images.
      const scale = Math.min(
        1,
        MAX_PREVIEW_SIZE / Math.max(naturalWidth, naturalHeight),
      );

      const width = Math.max(1, Math.round(naturalWidth * scale));

      const height = Math.max(1, Math.round(naturalHeight * scale));

      try {
        imageCanvas.width = width;
        imageCanvas.height = height;

        overlayCanvas.width = width;
        overlayCanvas.height = height;

        maskCanvas.width = width;
        maskCanvas.height = height;

        const imageCtx = imageCanvas.getContext("2d");
        const overlayCtx = overlayCanvas.getContext("2d");
        const maskCtx = maskCanvas.getContext("2d");

        if (!imageCtx || !overlayCtx || !maskCtx) {
          setImageError(
            "The browser could not create a 2D canvas. Try closing other tabs.",
          );
          setIsLoading(false);
          return;
        }

        imageCtx.drawImage(image, 0, 0, width, height);

        overlayCtx.clearRect(0, 0, width, height);

        maskCtx.fillStyle = "#000000";
        maskCtx.fillRect(0, 0, width, height);

        setImageSize({ width, height });
        setStrokeCount(0);
        setImageError("");
        setIsLoading(false);
      } catch (error) {
        console.error("Image canvas initialization failed:", error);

        setImageError(
          "Failed to initialize the image canvas. Try a smaller image.",
        );
        setIsLoading(false);
      }
    };

    image.onerror = () => {
      if (cancelled) return;

      console.error("Image loading failed:", imageUrl);

      setImageError(
        "The browser could not load this image. Try uploading it again or using a PNG/JPG/WEBP file.",
      );
      setIsLoading(false);
    };

    image.src = imageUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [imageUrl]);

  const getPoint = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ): Point | null => {
    const canvas = overlayCanvasRef.current;

    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    if (!rect.width || !rect.height) return null;

    return {
      x: Math.max(
        0,
        Math.min(
          canvas.width,
          ((event.clientX - rect.left) / rect.width) * canvas.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height,
          ((event.clientY - rect.top) / rect.height) * canvas.height,
        ),
      ),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLoading || imageError || drawingRef.current || isProcessing) return;

    event.preventDefault();

    const point = getPoint(event);

    if (!point) return;

    const stroke: Stroke = {
      points: [point],
      size: brushSizeRef.current,
    };

    drawingRef.current = true;
    currentStrokeRef.current = stroke;
    strokesRef.current = [...strokesRef.current, stroke];

    setStrokeCount(strokesRef.current.length);
    setIsDrawing(true);

    event.currentTarget.setPointerCapture(event.pointerId);
    redrawOverlay(strokesRef.current);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentStrokeRef.current) {
      return;
    }

    event.preventDefault();

    const point = getPoint(event);

    if (!point) return;

    currentStrokeRef.current.points.push(point);
    redrawOverlay(strokesRef.current);
  };

  const finishDrawing = () => {
    if (!drawingRef.current) return;

    drawingRef.current = false;
    currentStrokeRef.current = null;

    setIsDrawing(false);
  };

  const undo = () => {
    if (drawingRef.current) finishDrawing();

    strokesRef.current = strokesRef.current.slice(0, -1);

    setStrokeCount(strokesRef.current.length);
    redrawOverlay(strokesRef.current);
  };

  const clearSelection = () => {
    drawingRef.current = false;
    currentStrokeRef.current = null;
    strokesRef.current = [];

    setStrokeCount(0);
    setIsDrawing(false);
    redrawOverlay([]);
  };

  const exportMask = () => {
    const mask = maskCanvasRef.current;

    if (!mask || strokeCount === 0) return;

    try {
      const link = document.createElement("a");

      link.download = "image-toolkit-mask.png";
      link.href = mask.toDataURL("image/png");
      link.click();
    } catch (error) {
      console.error("Mask export failed:", error);
      setImageError("Failed to export the mask. Please try again.");
    }
  };

  const updateComparisonPosition = (clientX: number) => {
    const container = comparisonContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (!rect.width) return;

    const position = ((clientX - rect.left) / rect.width) * 100;
    setComparisonPosition(Math.max(0, Math.min(100, position)));
  };

  const handleComparisonPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingComparisonRef.current = true;
    updateComparisonPosition(event.clientX);
  };

  const handleComparisonPointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (!draggingComparisonRef.current) return;
    updateComparisonPosition(event.clientX);
  };

  const finishComparisonDrag = () => {
    draggingComparisonRef.current = false;
  };

  const processImage = async () => {
    const maskCanvas = maskCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;

    if (!maskCanvas || !imageCanvas || strokeCount === 0) {
      setProcessingError("Select the object you want to remove first.");
      return;
    }

    setIsProcessing(true);
    setProcessingError("");
    setProgress({
      phase: "preparing",
      message: "Preparing image...",
      percent: 0,
    });

    try {
      // Buat canvas resolusi penuh untuk gambar asli
      const originalImg = new Image();
      await new Promise<void>((resolve, reject) => {
        originalImg.onload = () => resolve();
        originalImg.onerror = () =>
          reject(new Error("Failed to load original image data."));
        originalImg.src = imageUrl;
      });

      const fullOriginalCanvas = document.createElement("canvas");
      fullOriginalCanvas.width = originalImg.naturalWidth;
      fullOriginalCanvas.height = originalImg.naturalHeight;
      const fullOrigCtx = fullOriginalCanvas.getContext("2d");
      if (!fullOrigCtx) {
        throw new Error("Unable to create canvas context for full image.");
      }
      fullOrigCtx.drawImage(originalImg, 0, 0);

      // Skalakan mask canvas ke resolusi penuh gambar asli
      const fullMaskCanvas = document.createElement("canvas");
      fullMaskCanvas.width = originalImg.naturalWidth;
      fullMaskCanvas.height = originalImg.naturalHeight;
      const fullMaskCtx = fullMaskCanvas.getContext("2d");
      if (!fullMaskCtx) {
        throw new Error("Unable to create canvas context for mask.");
      }
      fullMaskCtx.imageSmoothingEnabled = false;
      fullMaskCtx.drawImage(
        maskCanvas,
        0,
        0,
        originalImg.naturalWidth,
        originalImg.naturalHeight,
      );

      // Jalankan LaMa Inpainting client-side (100% di browser)
      const outputDataUrl = await runLamaInpaint(
        fullOriginalCanvas,
        fullMaskCanvas,
        (p) => setProgress(p),
      );

      setResultUrl(outputDataUrl);
    } catch (error) {
      console.error("Image processing failed:", error);

      setProcessingError(
        error instanceof Error
          ? error.message
          : "An error occurred while processing the image.",
      );
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  // ── Helper: determine completed step index ──────────────────────
  const currentPhaseIndex = progress
    ? PHASE_STEPS.findIndex((s) => s.key === progress.phase)
    : -1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Selection Editor</h3>

          <p className="mt-1 text-xs text-gray-400">
            Paint over the area you want to edit.
          </p>
        </div>

        <span className="rounded-full bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {strokeCount} stroke{strokeCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex min-h-[300px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#090b10] p-3 sm:p-5">
        <div className="relative inline-block max-w-full align-middle">
          <canvas
            ref={imageCanvasRef}
            className={`block h-auto max-h-[560px] max-w-full select-none object-contain ${
              imageSize.width === 0 ? "invisible" : ""
            }`}
            aria-label="Original image"
          />

          <canvas
            ref={overlayCanvasRef}
            aria-label="Brush selection canvas"
            className={`absolute inset-0 h-full w-full select-none ${
              imageSize.width === 0 ? "invisible" : ""
            } ${isProcessing ? "pointer-events-none" : "cursor-crosshair touch-none"}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrawing}
            onPointerCancel={finishDrawing}
            onLostPointerCapture={finishDrawing}
          />

          <canvas ref={maskCanvasRef} className="hidden" aria-hidden="true" />

          {/* AI scan overlay during processing */}
          {isProcessing && imageSize.width > 0 && (
            <div className="ai-scan-overlay pointer-events-none absolute inset-0 overflow-hidden rounded-lg bg-violet-500/[0.06]">
              <div className="absolute inset-0 border-2 border-violet-400/30 rounded-lg" />
            </div>
          )}

          {isLoading && (
            <div className="absolute inset-0 flex min-h-[260px] items-center justify-center">
              <p className="text-sm text-gray-400">Loading image...</p>
            </div>
          )}

          {!isLoading && imageError && (
            <div className="absolute inset-0 flex min-h-[260px] items-center justify-center p-6">
              <p className="text-center text-sm text-red-300">{imageError}</p>
            </div>
          )}
        </div>
      </div>

      <p className="text-right text-xs text-gray-500">
        Editor preview: {imageSize.width} × {imageSize.height} px
      </p>

      <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.04] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Client-Side AI Inpainting (LaMa)
            </h3>
            <span className="rounded-full bg-violet-500/20 px-2.5 py-0.5 text-[11px] font-medium text-violet-300">
              100% In-Browser ONNX
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-400">
            Powered by LaMa AI via ONNX Runtime WebAssembly running 100% locally in your browser. Complete privacy with zero server uploads—the AI model is downloaded once, cached in your browser via the Cache API, and composited using Smart ROI preserving full HD resolution.
          </p>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="mx-auto max-w-2xl space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="brush-size"
                  className="text-sm font-medium text-gray-200"
                >
                  Brush size
                </label>
                <span className="text-sm tabular-nums text-violet-300">
                  {brushSize} px
                </span>
              </div>
              <input
                id="brush-size"
                type="range"
                min="5"
                max="150"
                step="5"
                value={brushSize}
                disabled={isProcessing}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                className="mt-4 w-full cursor-pointer accent-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>Small</span>
                <span>Large</span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <p className="text-sm font-medium text-gray-200">
                Selection tools
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={undo}
                  disabled={strokeCount === 0 || isProcessing}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Undo
                </button>
                <button
                  onClick={clearSelection}
                  disabled={strokeCount === 0 || isProcessing}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  onClick={exportMask}
                  disabled={strokeCount === 0 || isProcessing}
                  className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Export Mask
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <button
          onClick={processImage}
          disabled={
            isLoading || !!imageError || isProcessing || strokeCount === 0
          }
          className="w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isProcessing ? "Processing Image..." : "Remove Object with AI (LaMa)"}
        </button>

        {/* ── Progress UI ─────────────────────────────────────────── */}
        {progress && (
          <div className="space-y-3 rounded-lg bg-violet-500/[0.07] p-4">
            {/* Phase stepper */}
            <div className="flex items-center justify-between gap-1">
              {PHASE_STEPS.map((step, idx) => {
                const isActive = idx === currentPhaseIndex;
                const isDone = idx < currentPhaseIndex;
                return (
                  <div key={step.key} className="flex flex-1 flex-col items-center gap-1.5">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                        isDone
                          ? "bg-violet-500 text-white"
                          : isActive
                            ? "bg-violet-400 text-white ring-2 ring-violet-400/40"
                            : "bg-white/10 text-gray-500"
                      }`}
                    >
                      {isDone ? "✓" : idx + 1}
                    </div>
                    <span
                      className={`text-[10px] leading-tight ${
                        isActive ? "font-semibold text-violet-300" : isDone ? "text-violet-400" : "text-gray-500"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`progress-bar-shimmer relative h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 ${
                  progress.phase === "downloading"
                    ? "transition-all duration-150 ease-out"
                    : "transition-none"
                }`}
                style={{ width: `${progress.percent ?? 0}%` }}
              />
            </div>

            {/* Status text */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-violet-300">{progress.message}</span>
              <span className="tabular-nums text-gray-400">
                {progress.phase === "downloading" && progress.loadedMB != null
                  ? progress.totalMB != null
                    ? `${progress.loadedMB} / ${progress.totalMB} MB`
                    : `${progress.loadedMB} MB`
                  : progress.percent != null
                    ? `${progress.percent}%`
                    : ""}
              </span>
            </div>
          </div>
        )}

        {processingError && (
          <p role="alert" className="text-sm text-red-300">
            {processingError}
          </p>
        )}

        {resultUrl && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-white">Before and After</h3>
              <div className="flex rounded-lg border border-white/10 p-1">
                <button
                  type="button"
                  onClick={() => setComparisonMode("slider")}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition ${comparisonMode === "slider" ? "bg-violet-500 text-white" : "text-gray-300 hover:bg-white/10"}`}
                >
                  Slider
                </button>
                <button
                  type="button"
                  onClick={() => setComparisonMode("side-by-side")}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition ${comparisonMode === "side-by-side" ? "bg-violet-500 text-white" : "text-gray-300 hover:bg-white/10"}`}
                >
                  Side by side
                </button>
              </div>
            </div>

            {comparisonMode === "slider" ? (
              <div className="space-y-3">
                <div
                  ref={comparisonContainerRef}
                  className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-white/10 bg-[#090b10]"
                  style={{
                    aspectRatio: `${imageSize.width || 4} / ${imageSize.height || 3}`,
                  }}
                >
                  <img
                    src={resultUrl}
                    alt="After: object removal result"
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                  <img
                    src={imageUrl}
                    alt="Before: original image"
                    className="absolute inset-0 h-full w-full object-contain"
                    style={{
                      clipPath: `inset(0 ${100 - comparisonPosition}% 0 0)`,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
                    style={{ left: `${comparisonPosition}%` }}
                  />
                  <button
                    type="button"
                    aria-label="Move the before and after divider"
                    title="Move left or right"
                    onPointerDown={handleComparisonPointerDown}
                    onPointerMove={handleComparisonPointerMove}
                    onPointerUp={finishComparisonDrag}
                    onPointerCancel={finishComparisonDrag}
                    className="absolute top-1/2 z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none cursor-ew-resize items-center justify-center rounded-full border border-white/80 bg-violet-500 text-lg font-bold text-white shadow-lg hover:bg-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    style={{ left: `${comparisonPosition}%` }}
                  >
                    ↔
                  </button>
                  <span className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">
                    Before
                  </span>
                  <span className="absolute right-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">
                    After
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  Drag the handle on the image to compare before and after.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-200">
                    Original Image
                  </p>
                  <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#090b10] p-2">
                    <img
                      src={imageUrl}
                      alt="Original image before object removal"
                      className="max-h-[560px] max-w-full object-contain"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-200">
                    Processed Result
                  </p>
                  <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#090b10] p-2">
                    <img
                      src={resultUrl}
                      alt="Result after object removal"
                      className="max-h-[560px] max-w-full object-contain"
                    />
                  </div>
                </div>
              </div>
            )}

            <a
              href={resultUrl}
              download="image-toolkit-result.png"
              className="block rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-medium text-gray-200 transition hover:bg-white/10"
            >
              Download Result PNG
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
