"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import {
  isUpscalerModelCached,
  runImageUpscaler,
  type UpscaleProgress,
} from "../lib/imageUpscaler";
import { useToast } from "./Toast";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

type OutputFormat = "image/png" | "image/jpeg" | "image/webp";
type ScaleFactor = 2 | 4;
type EnhancementStyle = "photo" | "illustration";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getOutputFormat(choice: OutputFormat): {
  mimeType: string;
  ext: string;
} {
  switch (choice) {
    case "image/jpeg":
      return { mimeType: "image/jpeg", ext: "jpg" };
    case "image/webp":
      return { mimeType: "image/webp", ext: "webp" };
    case "image/png":
    default:
      return { mimeType: "image/png", ext: "png" };
  }
}

export default function ImageUpscaler() {
  const inputRef = useRef<HTMLInputElement>(null);
  const comparisonContainerRef = useRef<HTMLDivElement>(null);
  const draggingComparisonRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelToastIdRef = useRef<string | null>(null);
  const { showToast, updateToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [originalDimensions, setOriginalDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Controls
  const [scale, setScale] = useState<ScaleFactor>(2);
  const [preset, setPreset] = useState<EnhancementStyle>("photo");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("image/png");

  // Output
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<UpscaleProgress | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultExt, setResultExt] = useState("png");
  const [resultDimensions, setResultDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [resultBlobSize, setResultBlobSize] = useState<number>(0);
  const [comparisonPosition, setComparisonPosition] = useState(50);
  const [isCached, setIsCached] = useState<boolean | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [completedDurationMs, setCompletedDurationMs] = useState<number | null>(null);

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  useEffect(() => {
    return () => {
      if (resultUrl && resultUrl.startsWith("blob:")) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [resultUrl]);

  // Check cache status
  useEffect(() => {
    let active = true;
    isUpscalerModelCached().then((cached) => {
      if (active) setIsCached(cached);
    });
    return () => {
      active = false;
    };
  }, []);

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";
    if (!selectedFile) return;

    if (
      !["image/png", "image/jpeg", "image/webp"].includes(selectedFile.type)
    ) {
      showToast(
        "error",
        "Unsupported file format. Please upload PNG, JPG, or WEBP.",
      );
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      showToast("error", "Maximum image size is 15 MB.");
      return;
    }

    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl && resultUrl.startsWith("blob:")) {
      URL.revokeObjectURL(resultUrl);
    }

    const url = URL.createObjectURL(selectedFile);
    const img = new Image();
    img.onload = () => {
      setFile(selectedFile);
      setOriginalUrl(url);
      setOriginalDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });

      // Auto detect output format matching original file
      const lower = selectedFile.name.toLowerCase();
      if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
        setOutputFormat("image/jpeg");
      } else if (lower.endsWith(".webp")) {
        setOutputFormat("image/webp");
      } else {
        setOutputFormat("image/png");
      }

      setResultUrl(null);
      setResultDimensions(null);
      setResultBlobSize(0);
      setCompletedDurationMs(null);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("error", "Failed to load image. Please try another file.");
    };

    img.src = url;
  }

  function resetImage() {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl && resultUrl.startsWith("blob:")) {
      URL.revokeObjectURL(resultUrl);
    }

    setFile(null);
    setOriginalUrl(null);
    setOriginalDimensions(null);
    setResultUrl(null);
    setResultDimensions(null);
    setResultBlobSize(0);
    setCompletedDurationMs(null);

    // Auto reset controls to default
    setScale(2);
    setPreset("photo");
    setOutputFormat("image/png");
    setComparisonPosition(50);
    setProgress(null);

    if (inputRef.current) inputRef.current.value = "";
  }

  function handleUpscaleClick() {
    if (!file || !originalUrl || isUpscaling) return;

    // If model is not cached yet, prompt user with confirmation modal
    if (!isCached) {
      setShowConfirmModal(true);
      return;
    }

    handleUpscale();
  }

  async function handleUpscale() {
    if (!file || !originalUrl || isUpscaling) return;

    setIsUpscaling(true);
    setIsCancelling(false);
    setCompletedDurationMs(null);
    setElapsedMs(0);
    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 250);

    setProgress({
      phase: "preparing",
      message: "Preparing image for AI upscaling...",
      percent: 5,
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load source image."));
        img.src = originalUrl;
      });

      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const { mimeType, ext } = getOutputFormat(outputFormat);

      const outputDataUrl = await runImageUpscaler(
        img,
        {
          scale,
          preset,
          quality: 0.94,
          onProgress: (p) => setProgress(p),
          signal: controller.signal,
        },
        mimeType,
      );

      // Estimate byte size from data URL length
      const base64Len = outputDataUrl.split(",")[1]?.length || 0;
      const estimatedBytes = Math.round((base64Len * 3) / 4);

      const targetW = (originalDimensions?.width || img.naturalWidth) * scale;
      const targetH = (originalDimensions?.height || img.naturalHeight) * scale;

      const duration = Date.now() - startTime;
      setCompletedDurationMs(duration);
      setResultUrl(outputDataUrl);
      setResultExt(ext);
      setResultDimensions({ width: targetW, height: targetH });
      setResultBlobSize(estimatedBytes);
      setComparisonPosition(50);
      setIsCached(true);

      showToast("success", `Image upscaled to ${scale}x successfully.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (cancelToastIdRef.current) {
          updateToast(
            cancelToastIdRef.current,
            "warning",
            "Upscaling cancelled.",
          );
          cancelToastIdRef.current = null;
        } else {
          showToast("warning", "Upscaling cancelled.");
        }
        return;
      }

      console.error("Upscale error:", error);
      showToast("error", "Failed to upscale image. Please try again.");
    } finally {
      clearInterval(timerInterval);
      abortControllerRef.current = null;
      setIsUpscaling(false);
      setIsCancelling(false);
      setProgress(null);
    }
  }

  function handleCancel() {
    if (abortControllerRef.current && !isCancelling) {
      setIsCancelling(true);
      const toastId = showToast("loading", "Cancelling upscaling...");
      cancelToastIdRef.current = toastId;
      abortControllerRef.current.abort();
    }
  }

  const updateComparisonFromClientX = (clientX: number) => {
    const container = comparisonContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const nextPercentage = Math.max(
      0,
      Math.min(100, (relativeX / rect.width) * 100),
    );
    setComparisonPosition(nextPercentage);
  };

  const handleComparisonPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingComparisonRef.current = true;
    updateComparisonFromClientX(event.clientX);
  };

  const handleComparisonPointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (!draggingComparisonRef.current) return;
    updateComparisonFromClientX(event.clientX);
  };

  const finishComparisonDrag = () => {
    draggingComparisonRef.current = false;
  };

  const estimatedWidth = originalDimensions
    ? originalDimensions.width * scale
    : 0;
  const estimatedHeight = originalDimensions
    ? originalDimensions.height * scale
    : 0;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-12">
      {/* Kolom Kiri: 8 Kolom */}
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#11141c] p-4 sm:p-5 lg:col-span-8">
        {file && originalUrl ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-white">Image Upscaler</h2>
                <p className="mt-1 truncate text-xs text-gray-400">
                  {file.name} · {formatFileSize(file.size)}
                  {originalDimensions && (
                    <span className="text-gray-300">
                      {" "}
                      · {originalDimensions.width} × {originalDimensions.height}{" "}
                      px
                      {" → "}
                      <span className="text-violet-400 font-medium">
                        {estimatedWidth} × {estimatedHeight} px ({scale}x)
                      </span>
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={isUpscaling}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Replace Image
                </button>
                <button
                  type="button"
                  onClick={resetImage}
                  disabled={isUpscaling}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove image and start over
                </button>
              </div>
            </div>

            {/* Visual Preview / Before-After Comparison Slider */}
            {resultUrl ? (
              <div className="space-y-4">
                {/* Stats Banner */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-4 text-xs">
                    <div>
                      <span className="text-gray-500">Original</span>
                      <p className="font-semibold text-white">
                        {originalDimensions?.width} ×{" "}
                        {originalDimensions?.height} px
                      </p>
                      <p className="text-gray-400">
                        {formatFileSize(file.size)}
                      </p>
                    </div>

                    <span className="text-gray-600">→</span>

                    <div>
                      <span className="text-violet-400">
                        Upscaled ({scale}x)
                      </span>
                      <p className="font-semibold text-white">
                        {resultDimensions?.width} × {resultDimensions?.height}{" "}
                        px
                      </p>
                      <p className="text-violet-300 font-medium">
                        {resultBlobSize > 0
                          ? formatFileSize(resultBlobSize)
                          : "HD"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                      +{scale === 4 ? "300%" : "100%"} Pixels
                    </span>

                    {completedDurationMs !== null && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium tabular-nums text-violet-300">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>Time: {formatDuration(completedDurationMs)}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Before / After Slider */}
                <div
                  ref={comparisonContainerRef}
                  className="relative mx-auto w-full overflow-hidden rounded-xl border border-white/10 bg-[#090b10]"
                  style={{
                    aspectRatio: `${originalDimensions?.width || 4} / ${originalDimensions?.height || 3}`,
                    maxHeight: "560px",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resultUrl}
                    alt="Upscaled result"
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={originalUrl}
                    alt="Original image"
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
                    aria-label="Move comparison divider"
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
                    Original
                  </span>
                  <span className="absolute right-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">
                    Upscaled {scale}x
                  </span>
                </div>

                {/* Download Button */}
                <a
                  href={resultUrl}
                  download={`${file.name.replace(/\.[^/.]+$/, "") || "image"}-upscaled-${scale}x.${resultExt}`}
                  onClick={() => {
                    const outName = `${file.name.replace(/\.[^/.]+$/, "") || "image"}-upscaled-${scale}x.${resultExt}`;
                    showToast("success", `Download started: ${outName}`);
                  }}
                  className="block w-full rounded-xl bg-violet-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-violet-500 shadow-md hover:shadow-violet-500/20"
                >
                  Download Result {resultExt.toUpperCase()}
                </a>
              </div>
            ) : (
              <div className="flex min-h-95 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#090b10] p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={originalUrl}
                  alt="Original preview"
                  className="max-h-[500px] max-w-full object-contain"
                />
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-95 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 px-6 py-12 text-center transition hover:border-violet-400 hover:bg-violet-400/5"
          >
            <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 text-3xl text-violet-300">
              ↑
            </span>
            <span className="text-lg font-semibold text-white">
              Upload an image
            </span>
            <span className="mt-2 text-sm text-gray-400">
              Click to browse files on your device
            </span>
            <span className="mt-4 text-xs text-gray-500">
              PNG, JPG, or WEBP · Maximum 15 MB
            </span>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Kolom Kanan: 4 Kolom Panel Upscale Controls */}
      <div className="space-y-5 lg:col-span-4">
        <aside className="rounded-2xl border border-white/10 bg-[#11141c] p-5 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Upscale Settings</h2>
            {isCached !== null && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  isCached
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                }`}
              >
                {isCached ? "Model Cached" : "Model ~5 MB"}
              </span>
            )}
          </div>

          {/* Scale Factor Selector */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Scale Factor
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScale(2)}
                disabled={!file || isUpscaling}
                className={`flex flex-col items-center rounded-xl border p-3 transition ${
                  scale === 2
                    ? "border-violet-500 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="text-base font-bold">2x</span>
                <span className="text-[11px] text-gray-400 mt-0.5">
                  Double Resolution
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScale(4)}
                disabled={!file || isUpscaling}
                className={`flex flex-col items-center rounded-xl border p-3 transition ${
                  scale === 4
                    ? "border-violet-500 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="text-base font-bold">4x</span>
                <span className="text-[11px] text-gray-400 mt-0.5">
                  Ultra HD 4K
                </span>
              </button>
            </div>
          </div>

          {/* Enhancement Style Selector */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Enhancement Style
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPreset("photo")}
                disabled={!file || isUpscaling}
                className={`flex flex-col items-center rounded-xl border p-3 transition ${
                  preset === "photo"
                    ? "border-violet-500 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="text-sm font-semibold">Photo</span>
                <span className="text-[11px] text-gray-400 mt-0.5">
                  Natural Textures
                </span>
              </button>

              <button
                type="button"
                onClick={() => setPreset("illustration")}
                disabled={!file || isUpscaling}
                className={`flex flex-col items-center rounded-xl border p-3 transition ${
                  preset === "illustration"
                    ? "border-violet-500 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="text-sm font-semibold">Illustration</span>
                <span className="text-[11px] text-gray-400 mt-0.5">
                  Clean Sharp Lines
                </span>
              </button>
            </div>

            {/* Explanation box for Photo vs Illustration */}
            <div className="mt-2.5 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-xs leading-relaxed text-gray-400">
              {preset === "photo" ? (
                <p>
                  <span className="font-medium text-violet-300">Photo:</span>{" "}
                  Preserves natural grain, skin tones, and realistic textures with stronger detail sharpening.
                </p>
              ) : (
                <p>
                  <span className="font-medium text-violet-300">Illustration:</span>{" "}
                  Keeps flat colors clean and edges crisp for anime, comics, logos, and digital art.
                </p>
              )}
            </div>
          </div>

          {/* Output Format Choice */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Output Format
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  { label: "PNG", value: "image/png" },
                  { label: "JPG", value: "image/jpeg" },
                  { label: "WebP", value: "image/webp" },
                ] as const
              ).map((fmt) => (
                <button
                  key={fmt.value}
                  type="button"
                  onClick={() => setOutputFormat(fmt.value)}
                  disabled={!file || isUpscaling}
                  className={`rounded-lg border py-2 text-xs font-semibold transition ${
                    outputFormat === fmt.value
                      ? "border-violet-500 bg-violet-500/20 text-violet-300"
                      : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Progress / Status Bar */}
          {isUpscaling && progress && (
            <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-violet-300">
                  {progress.message}
                </span>
                <span className="font-mono tabular-nums text-gray-400">
                  {progress.percent !== undefined
                    ? `${progress.percent}% · ${formatDuration(elapsedMs)}`
                    : formatDuration(elapsedMs)}
                </span>
              </div>

              {progress.percent !== undefined && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-violet-500 transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              )}

              {progress.loadedMB !== undefined && (
                <p className="text-[11px] text-gray-400 text-right">
                  {progress.loadedMB} MB
                  {progress.totalMB ? ` / ${progress.totalMB} MB` : ""}
                </p>
              )}

              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling}
                className="w-full rounded-lg border border-red-500/30 bg-red-500/10 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 mt-1"
              >
                {isCancelling ? "Cancelling..." : "Cancel"}
              </button>
            </div>
          )}

          {/* Main Action Button */}
          <button
            type="button"
            onClick={handleUpscaleClick}
            disabled={!file || isUpscaling}
            className="w-full rounded-xl bg-violet-600 px-4 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isUpscaling
              ? "Upscaling in progress..."
              : `Upscale Image ${scale}x`}
          </button>
        </aside>

        {/* Upscaler Guide Card */}
        <aside className="rounded-2xl border border-white/10 bg-[#11141c] p-5 space-y-3">
          <h4 className="text-sm font-semibold text-white">Upscaler Guide</h4>
          <ol className="list-inside list-decimal space-y-2 text-xs leading-5 text-gray-400">
            <li>Upload a photo, icon, or illustration up to 15 MB.</li>
            <li>Select your preferred scale factor (2x or 4x).</li>
            <li>
              Choose Photo for natural textures or Illustration for clean edges.
            </li>
            <li>Click Upscale Image to run client-side AI enhancement.</li>
          </ol>
          <div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-400/5 p-3 text-xs leading-5 text-gray-400">
            <span className="font-semibold text-violet-300">
              100% Private & Local
            </span>
            <p className="mt-1">
              All enhancements happen directly on your device. Your photos are
              never uploaded to external servers, and larger images may take a
              minute to process cleanly.
            </p>
          </div>
        </aside>
      </div>

      {/* AI Model Download Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#141620] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-xl">
                ✨
              </span>
              <div>
                <h3 className="text-base font-semibold text-white">
                  Download AI Model (~5 MB)
                </h3>
                <p className="text-xs text-gray-400">One-time browser download</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-gray-300">
              The AI Super-Resolution model (~5 MB) needs to be downloaded once. It will be stored in your browser cache for instant future use. All processing happens 100% locally on your device without uploading your photos.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-gray-300 transition hover:bg-white/10 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmModal(false);
                  handleUpscale();
                }}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 shadow-md hover:shadow-violet-500/20"
              >
                Download & Upscale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
