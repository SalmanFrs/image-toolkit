"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { isModelCached, runLamaInpaint } from "../lib/lamaInpaint";
import type { InpaintProgress } from "../lib/lamaInpaint";
import { useToast } from "./Toast";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

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
  fileName?: string;
  mode: EditorMode;
  onReplaceImage?: () => void;
  onRemoveImage?: () => void;
  isReplacingDisabled?: boolean;
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

export default function ImageEditor({
  imageUrl,
  fileName = "image",
  onReplaceImage,
  onRemoveImage,
  isReplacingDisabled,
}: ImageEditorProps) {
  const [editedImageUrl, setEditedImageUrl] = useState<string | null>(null);
  const activeImageUrl = editedImageUrl ?? imageUrl;
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);
  const comparisonContainerRef = useRef<HTMLDivElement>(null);
  const draggingComparisonRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [brushSize, setBrushSize] = useState(40);
  const [strokeCount, setStrokeCount] = useState(0);
  const [imageSize, setImageSize] = useState({
    width: 0,
    height: 0,
  });
  const [imageError, setImageError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<InpaintProgress | null>(null);
  const [processingError, setProcessingError] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultExt, setResultExt] = useState("png");
  const [comparisonPosition, setComparisonPosition] = useState(50);
  const [isCached, setIsCached] = useState<boolean | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [completedDurationMs, setCompletedDurationMs] = useState<number | null>(null);

  // ── Canvas Zoom & Pan state ────────────────────────────────────────
  const [toolMode, setToolMode] = useState<"brush" | "move">("brush");
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isSpacePressedRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const initialPinchDistRef = useRef<number | null>(null);
  const initialPinchZoomRef = useRef<number>(1);
  const canvasViewportRef = useRef<HTMLDivElement>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const clampPan = useCallback(
    (nextPan: { x: number; y: number }, currentZoom: number): { x: number; y: number } => {
      if (currentZoom <= 1) return { x: 0, y: 0 };
      const viewport = canvasViewportRef.current;
      const canvas = imageCanvasRef.current;
      if (!viewport || !canvas) return nextPan;

      const containerWidth = viewport.clientWidth;
      const containerHeight = viewport.clientHeight;
      const baseWidth = canvas.offsetWidth;
      const baseHeight = canvas.offsetHeight;

      const maxX = Math.max(0, (baseWidth * currentZoom - containerWidth) / 2);
      const maxY = Math.max(0, (baseHeight * currentZoom - containerHeight) / 2);

      return {
        x: Math.max(-maxX, Math.min(maxX, nextPan.x)),
        y: Math.max(-maxY, Math.min(maxY, nextPan.y)),
      };
    },
    [],
  );

  const { showToast, updateToast } = useToast();
  const cancelToastIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    isModelCached().then((cached) => {
      if (active) setIsCached(cached);
    });
    return () => {
      active = false;
    };
  }, []);

  // Desktop keyboard shortcut: Spacebar to toggle pan mode temporarily
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && (e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Desktop wheel handler: Ctrl+Scroll to zoom. Standard scroll scrolls the page naturally.
  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Pinch on trackpad or Ctrl+Wheel: Zoom
        e.preventDefault();
        const zoomDelta = e.deltaY < 0 ? 0.2 : -0.2;
        setZoom((prev) => {
          const next = Math.max(1, Math.min(4, Math.round((prev + zoomDelta) * 10) / 10));
          setPan((prevPan) => clampPan(prevPan, next));
          return next;
        });
      }
      // If neither Ctrl nor Meta is pressed, do NOT preventDefault(); let page scroll naturally
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, [clampPan]);

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
        resetView();
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

      console.error("Image loading failed:", activeImageUrl);

      setImageError(
        "The browser could not load this image. Try uploading it again or using a PNG/JPG/WEBP file.",
      );
      setIsLoading(false);
    };

    image.src = activeImageUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [activeImageUrl, resetView]);

  const getPoint = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ): Point | null => {
    const canvas = overlayCanvasRef.current;

    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    if (!rect.width || !rect.height) return null;

    const rawX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const rawY = ((event.clientY - rect.top) / rect.height) * canvas.height;

    // Clamp coordinates to canvas bounds
    let x = Math.max(0, Math.min(canvas.width, rawX));
    let y = Math.max(0, Math.min(canvas.height, rawY));

    // Edge-snapping: if brush point is within <= 6px from any canvas edge,
    // snap directly to 0 or width/height to eliminate 1-3px boundary gaps.
    const SNAP_MARGIN = 6;
    if (x <= SNAP_MARGIN) {
      x = 0;
    } else if (x >= canvas.width - SNAP_MARGIN) {
      x = canvas.width;
    }

    if (y <= SNAP_MARGIN) {
      y = 0;
    } else if (y >= canvas.height - SNAP_MARGIN) {
      y = canvas.height;
    }

    return { x, y };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLoading || imageError || isProcessing) return;

    activePointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    // Check if 2 fingers are touching (Pinch-to-zoom / 2-finger pan gesture)
    if (activePointersRef.current.size === 2) {
      // Abort any ongoing drawing stroke cleanly
      if (drawingRef.current) {
        drawingRef.current = false;
        currentStrokeRef.current = null;
      }
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialPinchDistRef.current = dist;
      initialPinchZoomRef.current = zoom;
      panStartRef.current = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
        panX: pan.x,
        panY: pan.y,
      };
      event.preventDefault();
      return;
    }

    // Check if in Move mode or Spacebar is held down
    if (toolMode === "move" || isSpacePressedRef.current || event.button === 1) {
      event.preventDefault();
      if (zoom > 1) {
        isPanningRef.current = true;
        panStartRef.current = {
          x: event.clientX,
          y: event.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {}
      }
      return;
    }

    // Normal Brush Mode (single finger / primary click)
    if (event.button !== 0 || drawingRef.current) return;

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

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // In case pointer capture is unsupported or already set
    }
    redrawOverlay(strokesRef.current);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }

    // 1. Two-finger pinch-to-zoom & pan
    if (activePointersRef.current.size >= 2) {
      event.preventDefault();
      const pts = Array.from(activePointersRef.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);

      if (initialPinchDistRef.current && initialPinchDistRef.current > 0) {
        const factor = currentDist / initialPinchDistRef.current;
        const newZoom = Math.max(
          1,
          Math.min(4, Math.round(initialPinchZoomRef.current * factor * 100) / 100),
        );
        setZoom(newZoom);

        // Pan with the midpoint
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const dx = midX - panStartRef.current.x;
        const dy = midY - panStartRef.current.y;
        setPan(
          clampPan(
            {
              x: panStartRef.current.panX + dx,
              y: panStartRef.current.panY + dy,
            },
            newZoom,
          ),
        );
      }
      return;
    }

    // 2. Single-pointer Pan in Move mode
    if (isPanningRef.current) {
      event.preventDefault();
      const dx = event.clientX - panStartRef.current.x;
      const dy = event.clientY - panStartRef.current.y;
      setPan(
        clampPan(
          {
            x: panStartRef.current.panX + dx,
            y: panStartRef.current.panY + dy,
          },
          zoom,
        ),
      );
      return;
    }

    // 3. Normal Brush Drawing
    if (!drawingRef.current || !currentStrokeRef.current) {
      return;
    }

    event.preventDefault();

    const point = getPoint(event);

    if (!point) return;

    currentStrokeRef.current.points.push(point);
    redrawOverlay(strokesRef.current);
  };

  const finishDrawing = (event?: React.PointerEvent<HTMLCanvasElement>) => {
    if (event?.pointerId !== undefined) {
      activePointersRef.current.delete(event.pointerId);
      if (event.currentTarget) {
        try {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Safe fallback
        }
      }
    }

    if (activePointersRef.current.size < 2) {
      initialPinchDistRef.current = null;
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
    }

    if (!drawingRef.current) return;

    drawingRef.current = false;
    currentStrokeRef.current = null;
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

  const handleProcessClick = () => {
    const maskCanvas = maskCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;

    if (!maskCanvas || !imageCanvas || strokeCount === 0) {
      setProcessingError("Select the object you want to remove first.");
      return;
    }

    if (!isCached) {
      setShowConfirmModal(true);
      return;
    }

    processImage();
  };

  const processImage = async () => {
    const maskCanvas = maskCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;

    if (!maskCanvas || !imageCanvas || strokeCount === 0) {
      setProcessingError("Select the object you want to remove first.");
      return;
    }

    setIsProcessing(true);
    setIsCancelling(false);
    setProcessingError("");
    setCompletedDurationMs(null);
    setElapsedMs(0);
    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 250);

    setProgress({
      phase: "preparing",
      message: "Preparing image...",
      percent: 0,
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Create full-resolution canvas for the active image
      const originalImg = new Image();
      await new Promise<void>((resolve, reject) => {
        originalImg.onload = () => resolve();
        originalImg.onerror = () =>
          reject(new Error("Failed to load original image data."));
        originalImg.src = activeImageUrl;
      });

      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const fullOriginalCanvas = document.createElement("canvas");
      fullOriginalCanvas.width = originalImg.naturalWidth;
      fullOriginalCanvas.height = originalImg.naturalHeight;
      const fullOrigCtx = fullOriginalCanvas.getContext("2d");
      if (!fullOrigCtx) {
        throw new Error("Unable to create canvas context for full image.");
      }
      fullOrigCtx.drawImage(originalImg, 0, 0);

      // Scale mask canvas to full resolution of the original image
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

      // Detect output format matching the input file (jpg/jpeg -> image/jpeg, webp -> image/webp, else png)
      const lowerName = fileName.toLowerCase();
      let targetMime = "image/png";
      let ext = "png";

      if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
        targetMime = "image/jpeg";
        ext = "jpg";
      } else if (lowerName.endsWith(".webp")) {
        targetMime = "image/webp";
        ext = "webp";
      }

      // Execute client-side LaMa Inpainting (100% in browser)
      const outputDataUrl = await runLamaInpaint(
        fullOriginalCanvas,
        fullMaskCanvas,
        (p) => setProgress(p),
        targetMime,
        controller.signal,
      );

      const duration = Date.now() - startTime;
      setCompletedDurationMs(duration);
      setIsCached(true);
      setResultExt(ext);
      setResultUrl(outputDataUrl);
      setComparisonPosition(50);
      resetView();
      showToast("success", "Object removed successfully.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // Cancelled cleanly by user, update toast to warning
        if (cancelToastIdRef.current) {
          updateToast(
            cancelToastIdRef.current,
            "warning",
            "Object removal cancelled.",
          );
          cancelToastIdRef.current = null;
        } else {
          showToast("warning", "Object removal cancelled.");
        }
        return;
      }

      console.error("Image processing failed:", error);

      showToast("error", "Failed to remove object. Please try again.");
      setProcessingError(
        error instanceof Error
          ? error.message
          : "An error occurred while processing the image.",
      );
    } finally {
      clearInterval(timerInterval);
      abortControllerRef.current = null;
      setIsProcessing(false);
      setIsCancelling(false);
      setProgress(null);
    }
  };

  const handleCancelProcessing = () => {
    if (abortControllerRef.current && !isCancelling) {
      setIsCancelling(true);
      const toastId = showToast("loading", "Cancelling object removal...");
      cancelToastIdRef.current = toastId;
      abortControllerRef.current.abort();
    }
  };

  const handleContinueEditing = () => {
    if (!resultUrl || isProcessing) return;

    setEditedImageUrl(resultUrl);
    setResultUrl(null);
    setCompletedDurationMs(null);
    strokesRef.current = [];
    currentStrokeRef.current = null;
    drawingRef.current = false;
    setStrokeCount(0);
    setToolMode("brush");
    setComparisonPosition(50);
    resetView();
    showToast("success", "Result loaded into editor for further editing.");
  };

  // ── Helper: determine completed step index ──────────────────────
  const currentPhaseIndex = progress
    ? PHASE_STEPS.findIndex((s) => s.key === progress.phase)
    : -1;

  return (
    <div className="space-y-5">
      {(onReplaceImage || onRemoveImage) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-white">Object Remover</h2>
            <p className="mt-1 truncate text-xs text-gray-400">
              {fileName}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onReplaceImage && (
              <button
                type="button"
                onClick={onReplaceImage}
                disabled={isProcessing || isReplacingDisabled}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Replace Image
              </button>
            )}

            {onRemoveImage && (
              <button
                type="button"
                onClick={onRemoveImage}
                disabled={isProcessing}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-300 transition hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove image and start over
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Selection Editor</h3>
            <p className="mt-0.5 text-xs text-gray-400">
              Paint over the area you want to edit.
            </p>
          </div>

          <span className="shrink-0 whitespace-nowrap rounded-full bg-red-500/10 px-3 py-1.5 text-xs text-red-300 sm:hidden">
            {strokeCount} stroke{strokeCount !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Zoom & Mode Toolbar */}
          <div className="flex items-center rounded-lg border border-white/10 bg-[#161822] p-1 text-xs">
            <button
              type="button"
              onClick={() => setToolMode("brush")}
              disabled={isProcessing}
              title="Brush Mode (Draw mask)"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                toolMode === "brush"
                  ? "bg-violet-500 text-white"
                  : "text-gray-400 hover:text-white"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span>🖌️</span>
              <span>Brush</span>
            </button>
            <button
              type="button"
              onClick={() => setToolMode("move")}
              disabled={isProcessing}
              title="Move Mode (Pan image)"
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                toolMode === "move"
                  ? "bg-violet-500 text-white"
                  : "text-gray-400 hover:text-white"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span>✋</span>
              <span>Move</span>
            </button>
          </div>

          <div className="flex items-center rounded-lg border border-white/10 bg-[#161822] p-1 text-xs">
            <button
              type="button"
              onClick={() =>
                setZoom((prev) => {
                  const next = Math.max(1, Math.round((prev - 0.25) * 100) / 100);
                  setPan((prevPan) => clampPan(prevPan, next));
                  return next;
                })
              }
              disabled={zoom <= 1 || isProcessing}
              title="Zoom out"
              className="rounded-md px-2 py-1 font-bold text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-12 text-center font-mono tabular-nums text-gray-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() =>
                setZoom((prev) => {
                  const next = Math.min(4, Math.round((prev + 0.25) * 100) / 100);
                  setPan((prevPan) => clampPan(prevPan, next));
                  return next;
                })
              }
              disabled={zoom >= 4 || isProcessing}
              title="Zoom in"
              className="rounded-md px-2 py-1 font-bold text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
            {(zoom > 1 || pan.x !== 0 || pan.y !== 0) && (
              <button
                type="button"
                onClick={resetView}
                disabled={isProcessing}
                title="Reset zoom & position"
                className="ml-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-400 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reset
              </button>
            )}
          </div>

          <span className="hidden shrink-0 whitespace-nowrap rounded-full bg-red-500/10 px-3 py-1.5 text-xs text-red-300 sm:inline-flex">
            {strokeCount} stroke{strokeCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div
        ref={canvasViewportRef}
        className="relative flex min-h-[300px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#090b10] p-3 sm:p-5 touch-none select-none"
      >
        <div
          className="relative inline-block max-w-full align-middle transition-transform duration-75 will-change-transform"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
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
            } ${
              isProcessing
                ? "pointer-events-none"
                : toolMode === "move" || isSpacePressed
                  ? "cursor-grab active:cursor-grabbing touch-none"
                  : "cursor-crosshair touch-none"
            }`}
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
              AI Object Removal
            </h3>
            {isCached !== null && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  isCached
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                }`}
              >
                {isCached ? "Model Cached" : "Model ~198 MB"}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-400">
            Remove unwanted objects, text, or blemishes directly in your browser.
            Your photos stay 100% private on your device, and the AI model is
            saved locally after the first download for instant future use.
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
          onClick={handleProcessClick}
          disabled={
            isLoading || !!imageError || isProcessing || strokeCount === 0
          }
          className="w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isProcessing
            ? "Processing Image..."
            : "Remove Object with AI (LaMa)"}
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
                  <div
                    key={step.key}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
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
                        isActive
                          ? "font-semibold text-violet-300"
                          : isDone
                            ? "text-violet-400"
                            : "text-gray-500"
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

            {/* Status text and cancel button */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs">
              <span className="min-w-0 truncate text-violet-300">
                {progress.message}
              </span>
              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                <span className="font-mono tabular-nums whitespace-nowrap text-gray-400">
                  {progress.phase === "downloading" && progress.loadedMB != null
                    ? progress.totalMB != null
                      ? `${progress.loadedMB} / ${progress.totalMB} MB · ${formatDuration(elapsedMs)}`
                      : `${progress.loadedMB} MB · ${formatDuration(elapsedMs)}`
                    : progress.percent != null
                      ? `${progress.percent}% · ${formatDuration(elapsedMs)}`
                      : formatDuration(elapsedMs)}
                </span>
                <button
                  type="button"
                  onClick={handleCancelProcessing}
                  disabled={isCancelling}
                  className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCancelling ? "Cancelling..." : "Cancel"}
                </button>
              </div>
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
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="font-semibold text-white">
                  Before / After Comparison
                </h3>
                {completedDurationMs !== null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium tabular-nums text-violet-300">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>Processed in {formatDuration(completedDurationMs)}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div
                ref={comparisonContainerRef}
                className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-white/10 bg-[#090b10]"
                style={{
                  aspectRatio: `${imageSize.width || 4} / ${imageSize.height || 3}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultUrl}
                  alt="After: object removal result"
                  className="absolute inset-0 h-full w-full object-contain"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeImageUrl}
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

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleContinueEditing}
                disabled={isProcessing}
                className="flex items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-center text-sm font-semibold text-violet-300 transition hover:border-violet-400/50 hover:bg-violet-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1"
              >
                <span>🖌️</span>
                <span>Continue Editing</span>
              </button>

              <a
                href={isProcessing ? undefined : resultUrl}
                download={
                  isProcessing
                    ? undefined
                    : `${fileName.replace(/\.[^/.]+$/, "") || "image"}-object-remover-result.${resultExt}`
                }
                aria-disabled={isProcessing}
                onClick={() => {
                  if (!isProcessing) {
                    const outName = `${fileName.replace(/\.[^/.]+$/, "") || "image"}-object-remover-result.${resultExt}`;
                    showToast("success", `Download started: ${outName}`);
                  }
                }}
                className={`flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-center text-sm font-semibold text-white transition shadow-md sm:flex-1 ${
                  isProcessing
                    ? "cursor-not-allowed opacity-50 pointer-events-none"
                    : "hover:bg-violet-500 hover:shadow-violet-500/20"
                }`}
              >
                <span>↓</span>
                <span>Download Result {resultExt.toUpperCase()}</span>
              </a>
            </div>
          </div>
        )}
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
                  Download AI Model (~198 MB)
                </h3>
                <p className="text-xs text-gray-400">One-time browser download</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-gray-300">
              The LaMa AI inpainting model (~198 MB) needs to be downloaded once. It will be stored in your browser cache for instant future use. All processing happens 100% locally on your device without uploading your photos.
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
                  processImage();
                }}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 shadow-md hover:shadow-violet-500/20"
              >
                Download & Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
