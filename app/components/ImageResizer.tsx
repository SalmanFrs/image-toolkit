"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";

type OutputFormat = "image/png" | "image/jpeg" | "image/webp";

const MAX_FILE_SIZE = 15 * 1024 * 1024;

export default function ImageResizer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [keepRatio, setKeepRatio] = useState(true);
  const [format, setFormat] = useState<OutputFormat>("image/png");
  const [quality, setQuality] = useState(0.9);
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputPreviewUrl, setOutputPreviewUrl] = useState<string | null>(null);
  const [outputPreviewSize, setOutputPreviewSize] = useState(0);
  const [outputPreviewDimensions, setOutputPreviewDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    return () => {
      if (outputPreviewUrl) {
        URL.revokeObjectURL(outputPreviewUrl);
      }
    };
  }, [outputPreviewUrl]);

  function selectFile(nextFile?: File) {
    if (!nextFile) return;

    if (!nextFile.type.startsWith("image/")) {
      showToast("error", "Please select a valid image file.");
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(nextFile.type)) {
      showToast("error", "Unsupported file format. Please upload PNG, JPG, or WEBP.");
      return;
    }

    if (nextFile.size > MAX_FILE_SIZE) {
      showToast("error", "Maximum image size is 15 MB.");
      return;
    }

    // Detect the format from the uploaded image.
    const formatMap: Record<string, OutputFormat> = {
      "image/jpeg": "image/jpeg",
      "image/png": "image/png",
      "image/webp": "image/webp",
    };

    const detectedFormat = formatMap[nextFile.type];
    if (detectedFormat) {
      setFormat(detectedFormat);
    }

    const url = URL.createObjectURL(nextFile);
    const image = new Image();

    image.onload = () => {
      setWidth(image.naturalWidth);
      setHeight(image.naturalHeight);
      setFile(nextFile);
      setOutputPreviewUrl(null);
      setOutputPreviewSize(0);
      setOutputPreviewDimensions(null);
      setError("");
      URL.revokeObjectURL(url);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("error", "Failed to load image. Please try another file.");
    };

    image.src = url;
  }

  function resetImage() {
    setFile(null);
    setWidth(0);
    setHeight(0);
    setKeepRatio(true);
    setFormat("image/png");
    setQuality(0.9);
    setOutputPreviewUrl(null);
    setOutputPreviewSize(0);
    setOutputPreviewDimensions(null);
    setError("");

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function updateWidth(value: number) {
    const nextWidth = Math.max(1, Math.min(12000, Math.round(value || 1)));
    setWidth(nextWidth);
    if (keepRatio && file && height > 0) {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        setHeight(
          Math.max(
            1,
            Math.round((nextWidth / image.naturalWidth) * image.naturalHeight),
          ),
        );
        URL.revokeObjectURL(url);
      };
      image.src = url;
    }
  }

  function updateHeight(value: number) {
    const nextHeight = Math.max(1, Math.min(12000, Math.round(value || 1)));
    setHeight(nextHeight);
    if (keepRatio && file) {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        setWidth(
          Math.max(
            1,
            Math.round((nextHeight / image.naturalHeight) * image.naturalWidth),
          ),
        );
        URL.revokeObjectURL(url);
      };
      image.src = url;
    }
  }

  async function createResizedBlob(): Promise<Blob> {
    if (!file) {
      throw new Error("No image selected.");
    }
    if (width < 1 || height < 1 || width > 12000 || height > 12000) {
      throw new Error("Dimensions must be between 1 and 12,000 pixels.");
    }

    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();
      throw new Error("Your browser could not process this image.");
    }

    if (format === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("Failed to create the output image.")),
        format,
        format === "image/png" ? undefined : quality,
      );
    });
  }

  async function handleGeneratePreview() {
    if (!file) return;
    setIsGeneratingPreview(true);
    setError("");

    try {
      const blob = await createResizedBlob();
      const url = URL.createObjectURL(blob);
      setOutputPreviewUrl(url);
      setOutputPreviewSize(blob.size);
      setOutputPreviewDimensions({ width, height });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "An error occurred while generating preview.",
      );
    } finally {
      setIsGeneratingPreview(false);
    }
  }

  async function resizeImage() {
    if (!file) return;
    setIsProcessing(true);
    setError("");

    try {
      const blob = await createResizedBlob();
      const extension =
        format === "image/jpeg"
          ? "jpg"
          : format === "image/webp"
            ? "webp"
            : "png";
      const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
      const downloadFileName = `${baseName}-resized-result.${extension}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFileName;
      link.click();
      URL.revokeObjectURL(url);
      showToast("success", "Image resized successfully.");
      showToast("success", `Download started: ${downloadFileName}`);
    } catch (caught) {
      showToast("error", "Failed to resize image.");
      setError(
        caught instanceof Error
          ? caught.message
          : "An error occurred while resizing the image.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#11141c] p-4 sm:p-5">
        {previewUrl && file ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">Image Resizer</h2>
                <p className="mt-1 truncate text-xs text-gray-400">
                  {file.name} ·{" "}
                  {file.size < 1024 * 1024
                    ? `${(file.size / 1024).toFixed(0)} KB`
                    : `${(file.size / (1024 * 1024)).toFixed(2)} MB`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    if (inputRef.current) {
                      inputRef.current.value = "";
                      inputRef.current.click();
                    }
                  }}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10"
                >
                  Replace Image
                </button>

                <button
                  onClick={resetImage}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
                >
                  Remove image and start over
                </button>
              </div>
            </div>

            <div className="flex min-h-[340px] items-center justify-center rounded-xl border border-white/10 bg-[#090b10] p-3">
              <img
                src={previewUrl}
                alt="Preview of the image to be resized"
                className="max-h-[560px] max-w-full object-contain"
              />
            </div>

            {outputPreviewUrl && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-[#090b10] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Output Preview
                    </h3>
                    <p className="text-xs text-gray-400">
                      {outputPreviewDimensions &&
                        `${outputPreviewDimensions.width} × ${outputPreviewDimensions.height} px · `}
                      {outputPreviewSize < 1024 * 1024
                        ? `${(outputPreviewSize / 1024).toFixed(1)} KB`
                        : `${(outputPreviewSize / (1024 * 1024)).toFixed(2)} MB`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setOutputPreviewUrl(null);
                      setOutputPreviewSize(0);
                      setOutputPreviewDimensions(null);
                    }}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-gray-400 transition hover:bg-white/10 hover:text-white"
                  >
                    Close Preview
                  </button>
                </div>

                <div className="flex max-h-[360px] items-center justify-center overflow-hidden rounded-lg border border-white/5 bg-[#11141c] p-2">
                  <img
                    src={outputPreviewUrl}
                    alt="Resized output preview"
                    className="max-h-[340px] max-w-full rounded object-contain"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            className="flex min-h-[380px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 px-6 py-12 text-center transition hover:border-violet-400 hover:bg-violet-400/5"
          >
            <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 text-3xl text-violet-300">
              ↑
            </span>
            <span className="text-lg font-semibold">Upload an image</span>
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
          accept="image/*"
          className="hidden"
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
      </div>

      <aside className="h-fit space-y-5 rounded-2xl border border-white/10 bg-[#11141c] p-5">
        <div>
          <h2 className="text-lg font-semibold">Resize Settings</h2>
          <p className="mt-1 text-sm text-gray-400">
            Set the output image dimensions.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-gray-300">
            Width (px)
            <input
              type="number"
              min="1"
              max="12000"
              value={width || ""}
              disabled={!file}
              onChange={(event) => updateWidth(Number(event.target.value))}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
          <label className="text-sm text-gray-300">
            Height (px)
            <input
              type="number"
              min="1"
              max="12000"
              value={height || ""}
              disabled={!file}
              onChange={(event) => updateHeight(Number(event.target.value))}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
        </div>
        <label
          className={`flex items-center gap-3 text-sm text-gray-300 ${
            !file ? "cursor-not-allowed opacity-40" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={keepRatio}
            disabled={!file}
            onChange={(event) => setKeepRatio(event.target.checked)}
            className="accent-violet-500 disabled:cursor-not-allowed"
          />{" "}
          Keep aspect ratio
        </label>
        <div>
          <label className="text-sm text-gray-300">
            Output format
            <select
              value={format}
              disabled={!file}
              onChange={(event) =>
                setFormat(event.target.value as OutputFormat)
              }
              className="mt-2 w-full rounded-lg border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <option value="image/png">PNG</option>
              <option value="image/jpeg">JPG</option>
              <option value="image/webp">WebP</option>
            </select>
          </label>
        </div>
        {format !== "image/png" && (
          <div>
            <div className="flex justify-between text-sm text-gray-300">
              <label htmlFor="quality">Quality</label>
              <span>{Math.round(quality * 100)}%</span>
            </div>
            <input
              id="quality"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={quality}
              disabled={!file}
              onChange={(event) => setQuality(Number(event.target.value))}
              className="mt-3 w-full accent-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>
        )}
        <button
          type="button"
          onClick={handleGeneratePreview}
          disabled={!file || isGeneratingPreview}
          className="w-full rounded-xl border border-violet-400/40 bg-violet-500/10 px-4 py-3 text-sm font-medium text-violet-300 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isGeneratingPreview ? "Generating Preview..." : "Preview Resize"}
        </button>

        <button
          onClick={resizeImage}
          disabled={!file || isProcessing}
          className="w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isProcessing ? "Processing..." : "Resize & Download"}
        </button>
        <p className="text-xs leading-5 text-gray-500">
          Images are processed directly in your browser. Files are not uploaded
          to the server. Maximum output dimensions: 12,000 × 12,000 pixels.
        </p>
      </aside>
    </div>
  );
}
