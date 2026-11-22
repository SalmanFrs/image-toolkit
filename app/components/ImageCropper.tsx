"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

const MAX_FILE_SIZE = 15 * 1024 * 1024;

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (err) => reject(err));
    image.src = url;
  });
}

function getRadianAngle(degreeValue: number) {
  return (degreeValue * Math.PI) / 180;
}

function rotateSize(width: number, height: number, rotation: number) {
  const rotRad = getRadianAngle(rotation);
  return {
    width:
      Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height:
      Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

async function getCroppedImageBlob(
  imageSrc: string,
  pixelCrop: Area,
  rotation = 0,
  format: "image/png" | "image/jpeg" | "image/webp" = "image/png",
): Promise<Blob | null> {
  const image = await createImage(imageSrc);
  const rotRad = getRadianAngle(rotation);

  // 1. Buat canvas sementara untuk menggambar gambar yang sudah dirotasi
  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(
    image.width,
    image.height,
    rotation,
  );

  const rotCanvas = document.createElement("canvas");
  rotCanvas.width = Math.round(bBoxWidth);
  rotCanvas.height = Math.round(bBoxHeight);
  const rotCtx = rotCanvas.getContext("2d");

  if (!rotCtx) return null;

  rotCtx.translate(bBoxWidth / 2, bBoxHeight / 2);
  rotCtx.rotate(rotRad);
  rotCtx.translate(-image.width / 2, -image.height / 2);
  rotCtx.drawImage(image, 0, 0);

  // 2. Buat canvas akhir sesuai ukuran area crop
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = Math.round(pixelCrop.width);
  outputCanvas.height = Math.round(pixelCrop.height);
  const outputCtx = outputCanvas.getContext("2d");

  if (!outputCtx) return null;

  // Isi background putih jika output JPG agar area transparan tidak jadi hitam
  if (format === "image/jpeg") {
    outputCtx.fillStyle = "#ffffff";
    outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  }

  outputCtx.drawImage(
    rotCanvas,
    Math.round(pixelCrop.x),
    Math.round(pixelCrop.y),
    Math.round(pixelCrop.width),
    Math.round(pixelCrop.height),
    0,
    0,
    outputCanvas.width,
    outputCanvas.height,
  );

  return new Promise((resolve) => {
    outputCanvas.toBlob(
      (blob) => resolve(blob),
      format,
      format === "image/png" ? undefined : 0.92,
    );
  });
}

export default function ImageCropper() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [error, setError] = useState("");

  // Crop settings
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [outputFormat, setOutputFormat] = useState<
    "image/png" | "image/jpeg" | "image/webp"
  >("image/png");
  const [isCropping, setIsCropping] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState(0);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  // Aspect ratio settings
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [selectedRatio, setSelectedRatio] = useState("Original");
  const [originalAspectRatio, setOriginalAspectRatio] = useState(4 / 3);

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    // Allow selecting the same file again.
    event.target.value = "";

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Supported formats: PNG, JPG, and WEBP.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError("Maximum image size is 15 MB.");
      return;
    }

    const newImageUrl = URL.createObjectURL(file);

    const image = new Image();

    image.onload = () => {
      const originalRatio = image.naturalWidth / image.naturalHeight;

      setImageUrl(newImageUrl);
      setFileName(file.name);
      setFileSize(file.size);
      setOutputFormat(file.type as "image/png" | "image/jpeg" | "image/webp");
      setOriginalAspectRatio(originalRatio);
      setAspectRatio(originalRatio);
      setSelectedRatio("Original");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setPreviewUrl(null);
      setPreviewSize(0);
      setError("");
    };

    image.onerror = () => {
      URL.revokeObjectURL(newImageUrl);
      setError("The image could not be read. Try another file.");
    };

    image.src = newImageUrl;
  }

  function resetImage() {
    setImageUrl(null);
    setFileName("");
    setFileSize(0);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCroppedAreaPixels(null);
    setOutputFormat("image/png");
    setAspectRatio(4 / 3);
    setOriginalAspectRatio(4 / 3);
    setSelectedRatio("Original");
    setPreviewUrl(null);
    setPreviewSize(0);
    setError("");

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  const handleCropChange = useCallback((newCrop: { x: number; y: number }) => {
    setCrop(newCrop);
  }, []);

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  const handleRotationChange = useCallback((newRotation: number) => {
    setRotation(newRotation);
  }, []);

  function handleRotateLeft() {
    setRotation((prev) => (prev - 90 + 360) % 360);
  }

  function handleRotateRight() {
    setRotation((prev) => (prev + 90) % 360);
  }

  const handleCropComplete = useCallback(
    (_croppedArea: Area, croppedPixels: Area) => {
      setCroppedAreaPixels(croppedPixels);
    },
    [],
  );

  async function handleGeneratePreview() {
    if (!imageUrl || !croppedAreaPixels) return;

    try {
      setIsGeneratingPreview(true);
      setError("");

      const blob = await getCroppedImageBlob(
        imageUrl,
        croppedAreaPixels,
        rotation,
        outputFormat,
      );

      if (!blob) {
        setError("Failed to generate crop preview.");
        return;
      }

      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewSize(blob.size);
    } catch {
      setError("An error occurred while generating preview.");
    } finally {
      setIsGeneratingPreview(false);
    }
  }

  async function handleCropAndDownload() {
    if (!imageUrl || !croppedAreaPixels) return;

    try {
      setIsCropping(true);
      setError("");

      const blob = await getCroppedImageBlob(
        imageUrl,
        croppedAreaPixels,
        rotation,
        outputFormat,
      );

      if (!blob) {
        setError("Failed to process cropped image.");
        return;
      }

      const extensionMap = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      };

      const baseName = fileName.replace(/\.[^/.]+$/, "") || "image";
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${baseName}-cropped.${extensionMap[outputFormat]}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch {
      setError("An error occurred while cropping the image.");
    } finally {
      setIsCropping(false);
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      {/* Crop Editor */}
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#11141c] p-4 sm:p-5">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        {imageUrl ? (
          <div className="space-y-4">
            {/* Image Information */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">Image Cropper</h2>
                <p className="mt-1 truncate text-xs text-gray-400">
                  {fileName}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => inputRef.current?.click()}
                  className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10"
                >
                  Replace Image
                </button>

                <button
                  onClick={resetImage}
                  className="rounded-lg px-3 py-2 text-sm text-gray-400 transition hover:bg-white/5 hover:text-white"
                >
                  Remove image and start over
                </button>
              </div>
            </div>

            {/* Interactive Crop Area */}
            <div className="relative h-[380px] overflow-hidden rounded-xl border border-white/10 bg-[#090b10] sm:h-[480px]">
              <Cropper
                image={imageUrl}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={aspectRatio}
                onCropChange={handleCropChange}
                onZoomChange={handleZoomChange}
                onRotationChange={handleRotationChange}
                onCropComplete={handleCropComplete}
                objectFit="contain"
                showGrid
              />
            </div>

            <p className="text-xs text-gray-500">
              Drag the image to adjust the crop area. Use the zoom control to
              get a closer view.
            </p>

            {previewUrl && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-[#090b10] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Output Preview
                    </h3>
                    <p className="text-xs text-gray-400">
                      {croppedAreaPixels &&
                        `${Math.round(croppedAreaPixels.width)} × ${Math.round(
                          croppedAreaPixels.height,
                        )} px · `}
                      {previewSize < 1024 * 1024
                        ? `${(previewSize / 1024).toFixed(1)} KB`
                        : `${(previewSize / (1024 * 1024)).toFixed(2)} MB`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setPreviewUrl(null);
                      setPreviewSize(0);
                    }}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-gray-400 transition hover:bg-white/10 hover:text-white"
                  >
                    Close Preview
                  </button>
                </div>

                <div className="flex max-h-[360px] items-center justify-center overflow-hidden rounded-lg border border-white/5 bg-[#11141c] p-2">
                  <img
                    src={previewUrl}
                    alt="Cropped output preview"
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
          accept="image/png,image/jpeg,image/webp"
          onChange={handleImageUpload}
          className="hidden"
        />
      </div>

      {/* Crop Settings */}
      <aside className="h-fit space-y-5 rounded-2xl border border-white/10 bg-[#11141c] p-5">
        <div>
          <h2 className="text-lg font-semibold">Crop Settings</h2>
          <p className="mt-1 text-sm text-gray-400">
            Adjust your image crop area.
          </p>
        </div>

        {/* Aspect Ratio */}
        <div>
          <label className="text-sm font-medium text-gray-300">
            Aspect Ratio
          </label>

          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              { label: "Original", value: originalAspectRatio },
              { label: "1:1", value: 1 },
              { label: "4:3", value: 4 / 3 },
              { label: "16:9", value: 16 / 9 },
              { label: "3:2", value: 3 / 2 },
              { label: "2:3", value: 2 / 3 },
              { label: "3:4", value: 3 / 4 },
              { label: "9:16", value: 9 / 16 },
            ].map((ratio) => (
              <button
                key={ratio.label}
                onClick={() => {
                  setAspectRatio(ratio.value);
                  setSelectedRatio(ratio.label);
                  setCrop({ x: 0, y: 0 });
                  setZoom(1);
                }}
                disabled={!imageUrl}
                className={`min-w-0 whitespace-nowrap rounded-lg border px-1 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  selectedRatio === ratio.label
                    ? "border-violet-400 bg-violet-500/20 text-violet-300"
                    : "border-white/10 text-gray-400 hover:border-violet-400/50 hover:bg-white/5"
                }`}
              >
                {ratio.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm text-gray-300">
            <label htmlFor="crop-zoom">Zoom</label>
            <span>{zoom.toFixed(1)}x</span>
          </div>

          <input
            id="crop-zoom"
            type="range"
            min="1"
            max="3"
            step="0.1"
            value={zoom}
            disabled={!imageUrl}
            onChange={(event) => handleZoomChange(Number(event.target.value))}
            className="mt-3 w-full accent-violet-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-sm text-gray-300">
            <span>Rotate</span>
            <span>{rotation}°</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleRotateLeft}
              disabled={!imageUrl}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-gray-300 transition hover:border-violet-400/50 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↺ -90°
            </button>

            <button
              type="button"
              onClick={handleRotateRight}
              disabled={!imageUrl}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-gray-300 transition hover:border-violet-400/50 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↻ +90°
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            setCrop({ x: 0, y: 0 });
            setZoom(1);
            setRotation(0);
            setPreviewUrl(null);
            setPreviewSize(0);
          }}
          disabled={!imageUrl}
          className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset Crop
        </button>

        {/* Output Format */}
        <div>
          <label className="text-sm font-medium text-gray-300">
            Output Format
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
                onClick={() => setOutputFormat(fmt.value)}
                disabled={!imageUrl}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  outputFormat === fmt.value
                    ? "border-violet-400 bg-violet-500/20 text-violet-300"
                    : "border-white/10 text-gray-400 hover:border-violet-400/50 hover:bg-white/5"
                }`}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview Crop */}
        <button
          type="button"
          onClick={handleGeneratePreview}
          disabled={!imageUrl || !croppedAreaPixels || isGeneratingPreview}
          className="w-full rounded-xl border border-violet-400/40 bg-violet-500/10 px-4 py-3 text-sm font-medium text-violet-300 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isGeneratingPreview ? "Generating Preview..." : "Preview Crop"}
        </button>

        {/* Crop & Download */}
        <button
          type="button"
          onClick={handleCropAndDownload}
          disabled={!imageUrl || !croppedAreaPixels || isCropping}
          className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isCropping ? "Cropping..." : "Crop & Download"}
        </button>

        <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 p-3">
          <p className="text-sm font-medium text-violet-300">
            Image Information
          </p>

          <p className="mt-2 text-xs leading-5 text-gray-400">
            {imageUrl ? (
              <>
                Size: {(fileSize / (1024 * 1024)).toFixed(2)} MB
                {croppedAreaPixels && (
                  <>
                    <br />
                    Output: {Math.round(croppedAreaPixels.width)} ×{" "}
                    {Math.round(croppedAreaPixels.height)} px
                  </>
                )}
              </>
            ) : (
              "No image uploaded."
            )}
          </p>
        </div>

        <p className="text-xs leading-5 text-gray-500">
          Images are processed directly in your browser. Files are not uploaded
          to the server.
        </p>
      </aside>
    </div>
  );
}
