"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { useToast } from "./Toast";

type OutputFormat = "image/png" | "image/jpeg" | "image/webp";

type BatchItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: "ready" | "converting" | "done" | "error";
  convertedBlob?: Blob;
  convertedUrl?: string;
  convertedSize?: number;
  convertedFormat?: OutputFormat;
  errorMessage?: string;
};

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES = 20;
const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFormatLabel(mimeType: string) {
  if (mimeType === "image/jpeg") return "JPG";
  if (mimeType === "image/webp") return "WEBP";
  return "PNG";
}

function getExtension(format: OutputFormat) {
  if (format === "image/jpeg") return "jpg";
  if (format === "image/webp") return "webp";
  return "png";
}

async function convertFileToBlob(
  file: File,
  format: OutputFormat,
  quality: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas context unavailable.");
  }

  // Fill with white background for JPG output so transparent areas do not turn black
  if (format === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to convert image."));
        }
      },
      format,
      format === "image/png" ? undefined : quality,
    );
  });
}

export default function BatchConverter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<BatchItem[]>([]);

  const [items, setItems] = useState<BatchItem[]>([]);
  const [targetFormat, setTargetFormat] = useState<OutputFormat>("image/webp");
  const [quality, setQuality] = useState(0.9);
  const [error, setError] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const { showToast, updateToast } = useToast();

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Clean up all object URLs when component unmounts
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        if (item.convertedUrl) {
          URL.revokeObjectURL(item.convertedUrl);
        }
      });
    };
  }, []);

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const selectedFiles = Array.from(fileList);
    event.target.value = "";

    const errors: string[] = [];
    const newItems: BatchItem[] = [];
    const remainingSlots = MAX_FILES - items.length;

    if (remainingSlots <= 0) {
      showToast("error", `Maximum ${MAX_FILES} images allowed per batch.`);
      return;
    }

    const filesToProcess = selectedFiles.slice(0, remainingSlots);
    if (selectedFiles.length > remainingSlots) {
      showToast(
        "warning",
        `Only the first ${remainingSlots} image(s) were added (max ${MAX_FILES} files per batch).`,
      );
    }

    for (const file of filesToProcess) {
      if (!SUPPORTED_TYPES.includes(file.type)) {
        showToast("error", `"${file.name}" skipped: unsupported format.`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        showToast("error", `"${file.name}" skipped: exceeds 15 MB limit.`);
        continue;
      }

      newItems.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "ready",
      });
    }

    if (newItems.length > 0) {
      setItems((prev) => [...prev, ...newItems]);
    }
  }

  function handleRemoveItem(id: string) {
    setItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.convertedUrl) {
          URL.revokeObjectURL(target.convertedUrl);
        }
      }
      return prev.filter((item) => item.id !== id);
    });
  }

  function handleClearAll() {
    items.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.convertedUrl) {
        URL.revokeObjectURL(item.convertedUrl);
      }
    });
    setItems([]);
    setTargetFormat("image/webp");
    setQuality(0.9);
    setError("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function handleConvertAll() {
    if (items.length === 0 || isConverting) return;

    setIsConverting(true);
    setError("");

    const currentItems = [...items];
    let successCount = 0;
    let failureCount = 0;

    for (const current of currentItems) {
      // Mark item as converting
      setItems((prev) =>
        prev.map((item) =>
          item.id === current.id
            ? { ...item, status: "converting", errorMessage: undefined }
            : item,
        ),
      );

      try {
        const blob = await convertFileToBlob(
          current.file,
          targetFormat,
          quality,
        );
        const convertedUrl = URL.createObjectURL(blob);
        successCount++;

        setItems((prev) =>
          prev.map((item) => {
            if (item.id !== current.id) return item;
            if (item.convertedUrl) {
              URL.revokeObjectURL(item.convertedUrl);
            }
            return {
              ...item,
              status: "done",
              convertedBlob: blob,
              convertedUrl,
              convertedSize: blob.size,
              convertedFormat: targetFormat,
            };
          }),
        );
      } catch (err) {
        failureCount++;
        const message =
          err instanceof Error ? err.message : "Conversion failed.";
        setItems((prev) =>
          prev.map((item) =>
            item.id === current.id
              ? { ...item, status: "error", errorMessage: message }
              : item,
          ),
        );
      }
    }

    if (successCount > 0 && failureCount === 0) {
      showToast("success", `Converted ${successCount} image(s) successfully.`);
    } else if (successCount > 0 && failureCount > 0) {
      showToast("warning", `Converted ${successCount} image(s), ${failureCount} failed.`);
    } else {
      showToast("error", "Failed to convert images.");
    }

    setIsConverting(false);
  }

  function handleDownloadSingle(item: BatchItem) {
    if (!item.convertedUrl || !item.convertedFormat) return;

    const baseName = item.file.name.replace(/\.[^/.]+$/, "") || "image";
    const ext = getExtension(item.convertedFormat);
    const downloadFileName = `${baseName}-converted-result.${ext}`;

    const link = document.createElement("a");
    link.href = item.convertedUrl;
    link.download = downloadFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("success", `Download started: ${downloadFileName}`);
  }

  const convertedCount = items.filter(
    (item) => item.status === "done" && item.convertedBlob,
  ).length;

  async function handleDownloadAllZip() {
    const convertedItems = items.filter(
      (item) =>
        item.status === "done" && item.convertedBlob && item.convertedFormat,
    );

    if (convertedItems.length === 0 || isZipping) return;

    const zipToastId = showToast("loading", "Creating ZIP archive...");

    try {
      setIsZipping(true);
      setError("");

      const zip = new JSZip();
      const usedNames = new Map<string, number>();

      for (const item of convertedItems) {
        const baseName = item.file.name.replace(/\.[^/.]+$/, "") || "image";
        const ext = getExtension(item.convertedFormat!);
        const initialName = `${baseName}.${ext}`;

        // Prevent duplicate file names from overwriting inside ZIP
        const count = usedNames.get(initialName) ?? 0;
        usedNames.set(initialName, count + 1);

        const finalName =
          count === 0 ? initialName : `${baseName}-${count}.${ext}`;

        zip.file(finalName, item.convertedBlob!);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipUrl = URL.createObjectURL(zipBlob);

      const link = document.createElement("a");
      link.href = zipUrl;
      link.download = "image-toolkit-converted.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(zipUrl);
      updateToast(zipToastId, "success", "ZIP archive downloaded.");
    } catch {
      updateToast(zipToastId, "error", "Failed to create ZIP archive.");
      setError("Failed to create ZIP archive.");
    } finally {
      setIsZipping(false);
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      {/* Upload Area & Image List */}
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#11141c] p-4 sm:p-5">
        {items.length > 0 ? (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">Batch Format Converter</h2>
                <p className="mt-1 text-xs text-gray-400">
                  {items.length} / {MAX_FILES} image
                  {items.length > 1 ? "s" : ""} selected
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={items.length >= MAX_FILES || isConverting}
                  className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add More Images
                </button>

                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={isConverting}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Daftar File */}
            <div className="max-h-[520px] space-y-2.5 overflow-y-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#090b10] p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={item.previewUrl}
                      alt={item.file.name}
                      className="h-12 w-12 shrink-0 rounded-lg border border-white/10 object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {item.file.name}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {getFormatLabel(item.file.type)} ·{" "}
                        {formatFileSize(item.file.size)}
                        {item.status === "done" &&
                          item.convertedSize !== undefined &&
                          item.convertedFormat && (
                            <span className="text-violet-300">
                              {" "}
                              → {getFormatLabel(item.convertedFormat)} ·{" "}
                              {formatFileSize(item.convertedSize)}
                            </span>
                          )}
                      </p>
                      {item.status === "error" && item.errorMessage && (
                        <p className="mt-0.5 text-xs text-red-400">
                          {item.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {item.status === "ready" && (
                      <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-300">
                        Ready
                      </span>
                    )}
                    {item.status === "converting" && (
                      <span className="rounded-md border border-violet-400/30 bg-violet-500/10 px-2 py-1 text-xs text-violet-300">
                        Converting...
                      </span>
                    )}
                    {item.status === "done" && (
                      <button
                        type="button"
                        onClick={() => handleDownloadSingle(item)}
                        className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                      >
                        Download
                      </button>
                    )}
                    {item.status === "error" && (
                      <span className="rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
                        Error
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={isConverting}
                      aria-label={`Remove ${item.file.name}`}
                      className="rounded-lg px-2 py-1 text-xs text-gray-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-[380px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 px-6 py-12 text-center transition hover:border-violet-400 hover:bg-violet-400/5"
          >
            <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 text-3xl text-violet-300">
              ↑
            </span>
            <span className="text-lg font-semibold">
              Upload multiple images
            </span>
            <span className="mt-2 text-sm text-gray-400">
              Click to select up to {MAX_FILES} images at once
            </span>
            <span className="mt-4 text-xs text-gray-500">
              PNG, JPG, or WEBP · Maximum 15 MB per file
            </span>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFilesSelected}
          className="hidden"
        />
      </div>

      {/* Panel Pengaturan */}
      <aside className="h-fit space-y-5 rounded-2xl border border-white/10 bg-[#11141c] p-5">
        <div>
          <h2 className="text-lg font-semibold">Batch Settings</h2>
          <p className="mt-1 text-sm text-gray-400">
            Convert multiple images to one format at once.
          </p>
        </div>

        {/* Target Format */}
        <div>
          <label className="text-sm font-medium text-gray-300">
            Target Format
          </label>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {(
              [
                { label: "PNG", value: "image/png" },
                { label: "JPG", value: "image/jpeg" },
                { label: "WEBP", value: "image/webp" },
              ] as const
            ).map((fmt) => (
              <button
                key={fmt.value}
                type="button"
                onClick={() => setTargetFormat(fmt.value)}
                disabled={items.length === 0}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  targetFormat === fmt.value
                    ? "border-violet-400 bg-violet-500/20 text-violet-300"
                    : "border-white/10 text-gray-400 hover:border-violet-400/50 hover:bg-white/5"
                }`}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quality Slider (khusus JPG & WEBP) */}
        {targetFormat !== "image/png" && (
          <div>
            <div className="flex items-center justify-between text-sm text-gray-300">
              <label htmlFor="batch-quality">Quality</label>
              <span>{Math.round(quality * 100)}%</span>
            </div>

            <input
              id="batch-quality"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={quality}
              disabled={items.length === 0}
              onChange={(event) => setQuality(Number(event.target.value))}
              className="mt-3 w-full accent-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleConvertAll}
          disabled={items.length === 0 || isConverting}
          className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isConverting ? "Converting..." : `Convert All (${items.length})`}
        </button>

        <button
          type="button"
          onClick={handleDownloadAllZip}
          disabled={convertedCount === 0 || isConverting || isZipping}
          className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-violet-500 hover:shadow-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isZipping
            ? "Creating ZIP..."
            : `Download All (.ZIP)${convertedCount > 0 ? ` (${convertedCount})` : ""}`}
        </button>

        <p className="text-xs leading-5 text-gray-500">
          Images are converted directly in your browser. Files are not uploaded
          to any server.
        </p>
      </aside>
    </div>
  );
}
