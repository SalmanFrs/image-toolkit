"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";

type OutputFormat = "image/jpeg" | "image/webp" | "image/png";
type CompressionMode = "quality" | "target";

const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getOutputFormat(choice: OutputFormat): {
  mimeType: "image/webp" | "image/jpeg" | "image/png";
  ext: string;
} {
  if (choice === "image/webp") return { mimeType: "image/webp", ext: "webp" };
  if (choice === "image/jpeg") return { mimeType: "image/jpeg", ext: "jpg" };
  return { mimeType: "image/png", ext: "png" };
}

async function renderCanvasAtScale(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension?: number,
): Promise<HTMLCanvasElement> {
  let width = sourceWidth;
  let height = sourceHeight;

  if (
    maxDimension &&
    maxDimension > 0 &&
    (width > maxDimension || height > maxDimension)
  ) {
    if (width >= height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context is unavailable.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: "image/webp" | "image/jpeg" | "image/png",
  quality: number,
): Promise<Blob> {
  // If exporting as JPEG, fill transparent background with white
  if (mimeType === "image/jpeg") {
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    const bgCtx = bgCanvas.getContext("2d");
    if (bgCtx) {
      bgCtx.fillStyle = "#ffffff";
      bgCtx.fillRect(0, 0, canvas.width, canvas.height);
      bgCtx.drawImage(canvas, 0, 0);
      return new Promise<Blob>((resolve, reject) => {
        bgCanvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("Failed to create blob.")),
          mimeType,
          quality,
        );
      });
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Failed to create blob.")),
      mimeType,
      mimeType === "image/png" ? undefined : quality,
    );
  });
}

export default function ImageCompressor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const comparisonContainerRef = useRef<HTMLDivElement>(null);
  const draggingComparisonRef = useRef(false);
  const { showToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [originalDimensions, setOriginalDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Settings
  const [mode, setMode] = useState<CompressionMode>("quality");
  const [quality, setQuality] = useState(80); // 10 to 100
  const [targetSizeInput, setTargetSizeInput] = useState("500"); // in KB as string
  const [outputFormatChoice, setOutputFormatChoice] =
    useState<OutputFormat>("image/jpeg");
  const [enableMaxDimension, setEnableMaxDimension] = useState(false);
  const [maxDimensionInput, setMaxDimensionInput] = useState("1920");

  // Output
  const [isCompressing, setIsCompressing] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultExt, setResultExt] = useState("webp");
  const [comparisonPosition, setComparisonPosition] = useState(50);

  // Separate cleanup for originalUrl
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  // Separate cleanup for resultUrl
  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

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
      showToast("error", "Maximum image size is 30 MB.");
      return;
    }

    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);

    const url = URL.createObjectURL(selectedFile);
    const img = new Image();
    img.onload = () => {
      // Auto-detect format matching the uploaded file
      let detectedFormat: OutputFormat = "image/jpeg";
      if (selectedFile.type === "image/webp") {
        detectedFormat = "image/webp";
      } else if (selectedFile.type === "image/png") {
        detectedFormat = "image/png";
      }

      setFile(selectedFile);
      setOriginalUrl(url);
      setOriginalDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      setOutputFormatChoice(detectedFormat);
      setResultBlob(null);
      setResultUrl(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("error", "Failed to load image. Please try another file.");
    };
    img.src = url;
  }

  function resetImage() {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setFile(null);
    setOriginalUrl(null);
    setOriginalDimensions(null);
    setResultBlob(null);
    setResultUrl(null);
    setMode("quality");
    setQuality(80);
    setTargetSizeInput("500");
    setOutputFormatChoice("image/jpeg");
    setEnableMaxDimension(false);
    setMaxDimensionInput("1920");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleCompress() {
    if (!file || isCompressing) return;

    setIsCompressing(true);

    let bitmap: ImageBitmap | null = null;
    let tempUrl: string | null = null;

    try {
      const parsedDim = parseInt(maxDimensionInput, 10);
      const effectiveMaxDim =
        !isNaN(parsedDim) && parsedDim >= 100 ? parsedDim : 1920;
      if (enableMaxDimension && (isNaN(parsedDim) || parsedDim < 100)) {
        setMaxDimensionInput(String(effectiveMaxDim));
      }

      const maxDim = enableMaxDimension ? effectiveMaxDim : undefined;
      let canvas: HTMLCanvasElement;

      if (typeof createImageBitmap !== "undefined") {
        bitmap = await createImageBitmap(file);
        canvas = await renderCanvasAtScale(
          bitmap,
          bitmap.width,
          bitmap.height,
          maxDim,
        );
      } else {
        tempUrl = URL.createObjectURL(file);
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to load source image."));
          img.src = tempUrl!;
        });
        canvas = await renderCanvasAtScale(
          img,
          img.naturalWidth,
          img.naturalHeight,
          maxDim,
        );
      }

      const { mimeType, ext } = getOutputFormat(outputFormatChoice);

      let finalBlob: Blob;

      if (mode === "quality") {
        // Direct compression with chosen quality factor
        const qFactor = quality / 100;
        finalBlob = await canvasToBlob(canvas, mimeType, qFactor);
      } else {
        // Target File Size Mode
        const parsedTargetKB = parseInt(targetSizeInput, 10);
        const effectiveTargetKB =
          !isNaN(parsedTargetKB) && parsedTargetKB >= 10 ? parsedTargetKB : 500;
        if (isNaN(parsedTargetKB) || parsedTargetKB < 10) {
          setTargetSizeInput(String(effectiveTargetKB));
        }

        const targetBytes = effectiveTargetKB * 1024;

        if (mimeType === "image/png") {
          // PNG is lossless in HTML5 Canvas. Dimension scaling is required to hit target sizes.
          let currentCanvas = canvas;
          let testBlob = await canvasToBlob(currentCanvas, "image/png", 1);

          let scaleIter = 0;
          while (
            testBlob.size > targetBytes &&
            scaleIter < 8 &&
            currentCanvas.width > 64 &&
            currentCanvas.height > 64
          ) {
            scaleIter++;
            const nextW = Math.max(64, Math.round(currentCanvas.width * 0.85));
            const nextH = Math.max(64, Math.round(currentCanvas.height * 0.85));

            const scaledCanvas = document.createElement("canvas");
            scaledCanvas.width = nextW;
            scaledCanvas.height = nextH;
            const sCtx = scaledCanvas.getContext("2d");
            if (sCtx) {
              sCtx.imageSmoothingEnabled = true;
              sCtx.imageSmoothingQuality = "high";
              sCtx.drawImage(currentCanvas, 0, 0, nextW, nextH);
              currentCanvas = scaledCanvas;
              testBlob = await canvasToBlob(currentCanvas, "image/png", 1);
            } else {
              break;
            }
          }

          finalBlob = testBlob;
        } else {
          // Lossy formats: JPEG & WebP
          // Step 1: Binary search quality between 0.10 and 0.95
          let low = 0.1;
          let high = 0.95;
          let bestBlob = await canvasToBlob(canvas, mimeType, high);

          if (bestBlob.size > targetBytes) {
            for (let iter = 0; iter < 7; iter++) {
              const mid = (low + high) / 2;
              const testBlob = await canvasToBlob(canvas, mimeType, mid);
              if (testBlob.size <= targetBytes) {
                bestBlob = testBlob;
                low = mid; // Try higher quality while staying under target
              } else {
                high = mid; // Need more compression
                bestBlob = testBlob;
              }
            }
          }

          // Step 2: Progressive dimension scaling fallback if lowest quality (0.10) is still over target
          let currentCanvas = canvas;
          if (bestBlob.size > targetBytes) {
            const minQualityBlob = await canvasToBlob(currentCanvas, mimeType, 0.1);
            let currentBlob = minQualityBlob.size < bestBlob.size ? minQualityBlob : bestBlob;

            let scaleIter = 0;
            while (
              currentBlob.size > targetBytes &&
              scaleIter < 8 &&
              currentCanvas.width > 64 &&
              currentCanvas.height > 64
            ) {
              scaleIter++;
              const nextW = Math.max(64, Math.round(currentCanvas.width * 0.85));
              const nextH = Math.max(64, Math.round(currentCanvas.height * 0.85));

              const scaledCanvas = document.createElement("canvas");
              scaledCanvas.width = nextW;
              scaledCanvas.height = nextH;
              const sCtx = scaledCanvas.getContext("2d");
              if (sCtx) {
                sCtx.imageSmoothingEnabled = true;
                sCtx.imageSmoothingQuality = "high";
                sCtx.drawImage(currentCanvas, 0, 0, nextW, nextH);
                currentCanvas = scaledCanvas;
                currentBlob = await canvasToBlob(currentCanvas, mimeType, 0.15);
              } else {
                break;
              }
            }
            bestBlob = currentBlob;
          }

          finalBlob = bestBlob;
        }
      }

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      const newResultUrl = URL.createObjectURL(finalBlob);

      setResultBlob(finalBlob);
      setResultUrl(newResultUrl);
      setResultExt(ext);
      setComparisonPosition(50);
      showToast("success", "Image compressed successfully.");
    } catch (err) {
      console.error("Compression error:", err);
      showToast("error", "Failed to compress image. Please try again.");
    } finally {
      if (bitmap) bitmap.close();
      if (tempUrl) URL.revokeObjectURL(tempUrl);
      setIsCompressing(false);
    }
  }

  function handleDownload() {
    if (!resultUrl || !file) return;
    const baseName = file.name.replace(/\.[^/.]+$/, "") || "image";
    const downloadFileName = `${baseName}-compressed-result.${resultExt}`;
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = downloadFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("success", `Download started: ${downloadFileName}`);
  }

  // Comparison slider events
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

  const originalBytes = file?.size ?? 0;
  const compressedBytes = resultBlob?.size ?? 0;
  const savingsPercent =
    originalBytes > 0 && compressedBytes > 0
      ? Math.round(((originalBytes - compressedBytes) / originalBytes) * 100)
      : 0;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Main Workspace */}
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#11141c] p-4 sm:p-5">
        {file && originalUrl ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-white">Image Compressor</h2>
                <p className="mt-1 truncate text-xs text-gray-400">
                  {file.name} · {formatFileSize(file.size)}
                  {originalDimensions
                    ? ` · ${originalDimensions.width} × ${originalDimensions.height} px`
                    : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10"
                >
                  Replace Image
                </button>
                <button
                  type="button"
                  onClick={resetImage}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
                >
                  Remove image and start over
                </button>
              </div>
            </div>

            {/* Visual Preview / Comparison */}
            {resultUrl ? (
              <div className="space-y-4">
                {/* Stats Banner */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-xs text-gray-400">Original Size</p>
                      <p className="font-semibold text-white tabular-nums">
                        {formatFileSize(originalBytes)}
                      </p>
                    </div>
                    <span className="text-gray-500">→</span>
                    <div>
                      <p className="text-xs text-gray-400">Compressed Size</p>
                      <p className="font-semibold text-white tabular-nums">
                        {formatFileSize(compressedBytes)}
                      </p>
                    </div>
                  </div>

                  {savingsPercent > 0 ? (
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                      Saved {savingsPercent}% (
                      {formatFileSize(originalBytes - compressedBytes)})
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300">
                      Already optimal ({savingsPercent}%)
                    </span>
                  )}
                </div>

                {/* Before / After Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-200">
                      Before / After Comparison
                    </h3>
                    <span className="text-xs text-gray-400">
                      Drag slider to compare visual quality
                    </span>
                  </div>

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
                      alt="Compressed result"
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
                      Compressed
                    </span>
                  </div>
                </div>

                {/* Download Button */}
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isCompressing}
                  className="w-full rounded-xl bg-violet-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-violet-500 shadow-md hover:shadow-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Download Result {resultExt.toUpperCase()}
                </button>
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
              Click to browse files from your device
            </span>
            <span className="mt-4 text-xs text-gray-500">
              PNG, JPG, or WEBP · Maximum 30 MB
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

      {/* Control Sidebar */}
      <aside className="h-fit space-y-5 rounded-2xl border border-white/10 bg-[#11141c] p-5">
        <h2 className="text-lg font-semibold text-white">
          Compression Controls
        </h2>

        {/* Compression Mode Selector */}
        <div>
          <label className="text-xs font-medium text-gray-400">
            Compression Mode
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!file}
              onClick={() => setMode("quality")}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "quality"
                  ? "border-violet-400 bg-violet-500/20 text-violet-300"
                  : "border-white/10 text-gray-400 hover:border-white/20"
              }`}
            >
              Quality Slider
            </button>
            <button
              type="button"
              disabled={!file}
              onClick={() => setMode("target")}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "target"
                  ? "border-violet-400 bg-violet-500/20 text-violet-300"
                  : "border-white/10 text-gray-400 hover:border-white/20"
              }`}
            >
              Target File Size
            </button>
          </div>
        </div>

        {/* Quality Controls */}
        {mode === "quality" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <label htmlFor="comp-quality" className="text-xs text-gray-400">
                Quality
              </label>
              <span className="font-semibold text-violet-300 tabular-nums">
                {quality}%
              </span>
            </div>
            <input
              id="comp-quality"
              type="range"
              min="10"
              max="100"
              step="5"
              value={quality}
              disabled={!file}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full accent-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            />
            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "High (85%)", value: 85 },
                { label: "Balanced (75%)", value: 75 },
                { label: "Max (50%)", value: 50 },
              ].map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  disabled={!file}
                  onClick={() => setQuality(preset.value)}
                  className={`rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    quality === preset.value
                      ? "border-violet-400 bg-violet-500/20 text-violet-300"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="target-size" className="text-xs text-gray-400">
              Target Maximum Size (KB)
            </label>
            <div className="relative">
              <input
                id="target-size"
                type="text"
                inputMode="numeric"
                value={targetSizeInput}
                disabled={!file}
                placeholder="500"
                onChange={(e) => {
                  const numericOnly = e.target.value.replace(/\D/g, "");
                  setTargetSizeInput(numericOnly);
                }}
                onBlur={() => {
                  const num = parseInt(targetSizeInput, 10);
                  if (isNaN(num) || num < 10) {
                    setTargetSizeInput("500");
                  } else if (num > 15000) {
                    setTargetSizeInput("15000");
                  }
                }}
                className="w-full rounded-lg border border-white/10 bg-black/20 pl-3 pr-12 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-gray-500">
                KB
              </span>
            </div>
            <p className="text-[11px] text-gray-500 leading-normal">
              Iterates automatically to find the optimal quality level under
              this file size.
            </p>
            {outputFormatChoice === "image/png" && (
              <p className="rounded-lg border border-violet-400/20 bg-violet-400/5 p-2 text-[11px] leading-relaxed text-violet-300">
                PNG is lossless; dimensions will be scaled down automatically if needed to meet the target size.
              </p>
            )}
          </div>
        )}

        {/* Output Format */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400">Output Format</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "JPG", value: "image/jpeg" },
              { label: "WebP", value: "image/webp" },
              { label: "PNG", value: "image/png" },
            ].map((fmt) => (
              <button
                key={fmt.value}
                type="button"
                disabled={!file}
                onClick={() => setOutputFormatChoice(fmt.value as OutputFormat)}
                className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  outputFormatChoice === fmt.value
                    ? "border-violet-400 bg-violet-500/20 text-violet-300"
                    : "border-white/10 text-gray-400 hover:border-white/20"
                }`}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Optional Max Dimension */}
        <div className="space-y-2.5 border-t border-white/10 pt-4">
          <label
            className={`flex items-center gap-2 text-xs text-gray-300 ${
              !file ? "cursor-not-allowed opacity-40" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={enableMaxDimension}
              disabled={!file}
              onChange={(e) => setEnableMaxDimension(e.target.checked)}
              className="accent-violet-500 disabled:cursor-not-allowed"
            />
            <span>Resize max dimension</span>
          </label>

          {enableMaxDimension && (
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={maxDimensionInput}
                disabled={!file}
                placeholder="1920"
                onChange={(e) => {
                  const numericOnly = e.target.value.replace(/\D/g, "");
                  setMaxDimensionInput(numericOnly);
                }}
                onBlur={() => {
                  const num = parseInt(maxDimensionInput, 10);
                  if (isNaN(num) || num < 100) {
                    setMaxDimensionInput("1920");
                  } else if (num > 12000) {
                    setMaxDimensionInput("12000");
                  }
                }}
                className="w-full rounded-lg border border-white/10 bg-black/20 pl-3 pr-10 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-gray-500">
                px
              </span>
            </div>
          )}
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={handleCompress}
          disabled={!file || isCompressing}
          className="w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40 shadow-md hover:shadow-violet-500/20"
        >
          {isCompressing ? "Compressing Image..." : "Compress Image"}
        </button>

        {/* Mini Guide */}
        <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 p-3">
          <p className="text-xs font-medium text-violet-300">
            Compressor Guide
          </p>
          <ul className="mt-2 list-disc list-inside space-y-1 text-[11px] text-gray-400">
            <li>100% private, client-side HTML5 Canvas rasterization.</li>
            <li>
              WebP format produces the greatest reduction with high clarity.
            </li>
            <li>Target file size automatically performs binary search.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
