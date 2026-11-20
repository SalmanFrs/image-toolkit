"use client";

import { useEffect, useRef, useState } from "react";
import ImageEditor from "./components/ImageEditor";
import ImageResizer from "./components/ImageResizer";
import ImageCropper from "./components/ImageCropper";
import BatchConverter from "./components/BatchConverter";

type ActiveTool = "remove" | "resize" | "crop" | "convert";

export default function Home() {
  const [activeTool, setActiveTool] = useState<ActiveTool>("remove");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file.");
      event.target.value = "";
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Supported formats: PNG, JPG, and WEBP.");
      event.target.value = "";
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Maximum image size is 15 MB.");
      event.target.value = "";
      return;
    }
    setError("");
    setImageUrl(URL.createObjectURL(file));
    setFileName(file.name);
  }

  function resetImage() {
    setImageUrl(null);
    setFileName("");
    setError("");
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
            images—with fast browser processing and AI where it helps most.
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
                    <ImageEditor
                      key={imageUrl}
                      imageUrl={imageUrl}
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
                  <li>Choose AI or OpenCV and adjust the settings.</li>
                  <li>
                    Process the image, compare the result, then download it.
                  </li>
                </ol>
                <div className="mt-6 rounded-xl border border-violet-400/20 bg-violet-400/5 p-3">
                  <p className="text-sm font-medium text-violet-300">
                    Processing
                  </p>
                  <p className="mt-2 text-xs leading-5 text-gray-400">
                    AI processing requires the connected Google Colab Gradio
                    session to be active. OpenCV Telea is a lighter alternative.
                  </p>
                </div>
                <p className="mt-4 text-xs leading-5 text-gray-500">
                  Red areas indicate the selected region. The original image is
                  retained for processing; the editor preview may be scaled for
                  performance.
                </p>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs text-gray-500">
        Image Toolkit · Built with Next.js, FastAPI &amp; OpenCV
      </footer>
    </main>
  );
}
