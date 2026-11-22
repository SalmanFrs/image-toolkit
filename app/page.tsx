"use client";

import { useEffect, useRef, useState } from "react";
import ImageEditor from "./components/ImageEditor";
import ImageResizer from "./components/ImageResizer";
import ImageCropper from "./components/ImageCropper";
import BatchConverter from "./components/BatchConverter";
import ImageCompressor from "./components/ImageCompressor";
import { useToast } from "./components/Toast";

type ActiveTool = "remove" | "compress" | "resize" | "crop" | "convert";

export default function Home() {
  const [activeTool, setActiveTool] = useState<ActiveTool>("remove");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      showToast("error", "Unsupported file format. Please upload PNG, JPG, or WEBP.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast("error", "Maximum image size is 15 MB.");
      return;
    }

    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    setFileName(file.name);
  }

  function resetImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <main className="min-h-screen bg-[#0b0d12] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <a href="/" className="text-xl font-bold tracking-tight">
            <span className="text-violet-400">Image</span> Toolkit
          </a>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400">
            Client + AI Studio
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-10 text-center">
          <p className="mb-3 text-sm font-medium text-violet-400">
            IMAGE TOOLS FOR EVERYDAY WORK
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            Your images, <span className="text-violet-400">your way.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-gray-400 sm:text-base">
            Practical tools to remove objects, resize, crop, and batch-convert
            images with fast browser processing and AI where it helps most.
          </p>
        </div>

        <div className="mx-auto max-w-6xl">
          <div
            className="mb-5 flex flex-wrap gap-3"
            role="tablist"
            aria-label="Image tools"
          >
            <button
              role="tab"
              aria-selected={activeTool === "remove"}
              onClick={() => setActiveTool("remove")}
              className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
                activeTool === "remove"
                  ? "bg-violet-500 text-white"
                  : "border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              Object Remover
            </button>
            <button
              role="tab"
              aria-selected={activeTool === "compress"}
              onClick={() => setActiveTool("compress")}
              className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
                activeTool === "compress"
                  ? "bg-violet-500 text-white"
                  : "border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              Image Compressor
            </button>
            <button
              role="tab"
              aria-selected={activeTool === "resize"}
              onClick={() => setActiveTool("resize")}
              className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
                activeTool === "resize"
                  ? "bg-violet-500 text-white"
                  : "border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              Image Resizer
            </button>
            <button
              role="tab"
              aria-selected={activeTool === "crop"}
              onClick={() => setActiveTool("crop")}
              className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
                activeTool === "crop"
                  ? "bg-violet-500 text-white"
                  : "border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              Image Cropper
            </button>
            <button
              role="tab"
              aria-selected={activeTool === "convert"}
              onClick={() => setActiveTool("convert")}
              className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
                activeTool === "convert"
                  ? "bg-violet-500 text-white"
                  : "border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              Batch Converter
            </button>
          </div>

          {/* Image Compressor: keep mounted so its state is preserved when switching tools. */}
          <div className={activeTool === "compress" ? "block" : "hidden"}>
            <ImageCompressor />
          </div>

          {/* Image Resizer: keep mounted so its state is preserved when switching tools. */}
          <div className={activeTool === "resize" ? "block" : "hidden"}>
            <ImageResizer />
          </div>

          {/* Image Cropper: keep mounted so its state is preserved when switching tools. */}
          <div className={activeTool === "crop" ? "block" : "hidden"}>
            <ImageCropper />
          </div>

          {/* Batch Converter: keep mounted so its state is preserved when switching tools. */}
          <div className={activeTool === "convert" ? "block" : "hidden"}>
            <BatchConverter />
          </div>

          {/* Object Remover: keep mounted so its state is preserved when switching tools. */}
          <div className={activeTool === "remove" ? "block" : "hidden"}>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-[#11141c] p-4 sm:p-5">
                {imageUrl ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold">Object Remover</h2>
                        <p className="mt-1 truncate text-xs text-gray-400">
                          {fileName}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
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
                    <ImageEditor
                      key={imageUrl}
                      imageUrl={imageUrl}
                      fileName={fileName}
                      mode="remove"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex min-h-[380px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 px-6 py-12 text-center transition hover:border-violet-400 hover:bg-violet-400/5"
                  >
                    <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 text-3xl text-violet-300">
                      ↑
                    </span>
                    <span className="text-lg font-semibold">
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
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
              <aside className="h-fit rounded-2xl border border-white/10 bg-[#11141c] p-5">
                <h2 className="text-lg font-semibold">Object Remover Guide</h2>
                <div className="mt-5 rounded-lg bg-white/5 p-3 text-sm font-medium">
                  Remove unwanted objects
                </div>
                <ol className="mt-5 list-inside list-decimal space-y-3 text-sm leading-6 text-gray-400">
                  <li>Upload an image.</li>
                  <li>Paint over the object you want to remove.</li>
                  <li>Click &quot;Remove Object with AI (LaMa)&quot;.</li>
                  <li>
                    Compare the result using the slider or side-by-side view, then download.
                  </li>
                </ol>
                <div className="mt-6 rounded-xl border border-violet-400/20 bg-violet-400/5 p-3">
                  <p className="text-sm font-medium text-violet-300">
                    100% Client-Side Processing
                  </p>
                  <p className="mt-2 text-xs leading-5 text-gray-400">
                    Runs entirely in your browser using ONNX Runtime Web. Zero server latency, full privacy, and instant subsequent runs via browser Cache API.
                  </p>
                </div>
                <p className="mt-4 text-xs leading-5 text-gray-500">
                  Red areas indicate your selection mask. High-resolution compositing ensures surrounding pixels remain crisp without quality degradation.
                </p>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-gray-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-2 sm:flex-row sm:gap-4">
          <span>Image Toolkit · Privacy-First Client-Side AI Studio</span>
          <span className="hidden sm:inline">·</span>
          <a
            href="https://github.com/SalmanFrs/image-toolkit"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-gray-400 transition hover:text-white"
          >
            <svg
              className="h-4 w-4 fill-current"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
            <span>View source code on GitHub</span>
          </a>
        </div>
      </footer>
    </main>
  );
}
