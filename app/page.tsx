"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ImageEditor from "./components/ImageEditor";
import ImageResizer from "./components/ImageResizer";
import ImageCropper from "./components/ImageCropper";
import BatchConverter from "./components/BatchConverter";
import ImageCompressor from "./components/ImageCompressor";
import ImageUpscaler from "./components/ImageUpscaler";
import { useToast } from "./components/Toast";

type ActiveTool = "remove" | "upscale" | "compress" | "resize" | "crop" | "convert";

interface ToolOption {
  id: ActiveTool;
  name: string;
  sublabel: string;
  icon: string;
}

const TOOLS: ToolOption[] = [
  {
    id: "remove",
    name: "Object Remover",
    sublabel: "Remove unwanted objects & watermark with AI",
    icon: "🪄",
  },
  {
    id: "upscale",
    name: "Image Upscaler",
    sublabel: "Super-Resolution 2x / 4x enhancement with AI",
    icon: "✨",
  },
  {
    id: "compress",
    name: "Image Compressor",
    sublabel: "Reduce file size with visual clarity",
    icon: "⚡",
  },
  {
    id: "resize",
    name: "Image Resizer",
    sublabel: "Scale dimensions & change formats",
    icon: "📐",
  },
  {
    id: "crop",
    name: "Image Cropper",
    sublabel: "Crop, rotate & preset aspect ratios",
    icon: "✂️",
  },
  {
    id: "convert",
    name: "Batch Converter",
    sublabel: "Convert multiple files & ZIP download",
    icon: "📦",
  },
];

export default function Home() {
  const [activeTool, setActiveTool] = useState<ActiveTool>("remove");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        mobileDropdownRef.current &&
        !mobileDropdownRef.current.contains(event.target as Node)
      ) {
        setIsMobileMenuOpen(false);
      }
    }

    if (isMobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMobileMenuOpen]);

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

  const currentTool = TOOLS.find((t) => t.id === activeTool) || TOOLS[0];

  return (
    <main className="min-h-screen bg-[#0b0d12] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2.5 text-xl font-bold tracking-tight transition hover:opacity-90">
            <Image
              src="/logo.svg"
              alt="Image Toolkit Logo"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-lg shadow-sm"
            />
            <span>
              <span className="text-violet-400">Image</span> Toolkit
            </span>
          </Link>
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
            Practical tools to remove objects, upscale, compress, resize, crop, and
            batch-convert images with fast browser processing and AI where it helps most.
          </p>
        </div>

        <div className="mx-auto max-w-6xl">
          {/* Mobile Tool Selector Dropdown (< md) */}
          <div ref={mobileDropdownRef} className="relative mb-5 md:hidden">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              aria-expanded={isMobileMenuOpen}
              aria-haspopup="listbox"
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#141620] px-4 py-3.5 text-left shadow-lg transition active:scale-[0.99] hover:border-violet-400/50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-lg">
                  {currentTool.icon}
                </span>
                <div className="min-w-0">
                  <span className="block font-semibold text-white leading-tight">
                    {currentTool.name}
                  </span>
                  <span className="block truncate text-xs text-gray-400 mt-0.5">
                    {currentTool.sublabel}
                  </span>
                </div>
              </div>
              <svg
                className={`h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200 ${
                  isMobileMenuOpen ? "rotate-180 text-violet-300" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isMobileMenuOpen && (
              <div
                role="listbox"
                className="absolute left-0 right-0 top-full z-40 mt-2 space-y-1 rounded-2xl border border-white/15 bg-[#161822] p-2 shadow-2xl backdrop-blur-xl"
              >
                {TOOLS.map((tool) => {
                  const isSelected = tool.id === activeTool;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setActiveTool(tool.id);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl p-2.5 text-left transition ${
                        isSelected
                          ? "bg-violet-500/15 border border-violet-400/30 text-white"
                          : "text-gray-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-base">
                          {tool.icon}
                        </span>
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${isSelected ? "text-violet-300 font-semibold" : ""}`}>
                            {tool.name}
                          </p>
                          <p className="truncate text-xs text-gray-400">
                            {tool.sublabel}
                          </p>
                        </div>
                      </div>
                      {isSelected && (
                        <svg
                          className="h-4 w-4 shrink-0 text-violet-400 mr-1"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Desktop Tool Selector Tabs (>= md) */}
          <div
            className="mb-5 hidden md:flex flex-wrap gap-3"
            role="tablist"
            aria-label="Image tools"
          >
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                role="tab"
                aria-selected={activeTool === tool.id}
                onClick={() => setActiveTool(tool.id)}
                className={`rounded-xl px-5 py-3 text-sm font-medium transition ${
                  activeTool === tool.id
                    ? "bg-violet-500 text-white"
                    : "border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                {tool.name}
              </button>
            ))}
          </div>

          {/* Image Upscaler: keep mounted so its state is preserved when switching tools. */}
          <div className={activeTool === "upscale" ? "block" : "hidden"}>
            <ImageUpscaler />
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
                  <ImageEditor
                    key={imageUrl}
                    imageUrl={imageUrl}
                    fileName={fileName}
                    mode="remove"
                    onReplaceImage={() => fileInputRef.current?.click()}
                    onRemoveImage={resetImage}
                  />
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex min-h-95 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 px-6 py-12 text-center transition hover:border-violet-400 hover:bg-violet-400/5"
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
                    Compare the result using the interactive comparison slider, then download.
                  </li>
                </ol>
                <div className="mt-6 rounded-xl border border-violet-400/20 bg-violet-400/5 p-3">
                  <p className="text-sm font-medium text-violet-300">
                    Pro Tip for Clean Results
                  </p>
                  <p className="mt-2 text-xs leading-5 text-gray-400">
                    Brush slightly wider than the object and its shadow or glow so the AI blends the background seamlessly. Your images are never uploaded to any server.
                  </p>
                </div>
                <p className="mt-4 text-xs leading-5 text-gray-500">
                  Red areas highlight your brush selection. The clean replacement blends smoothly into the surrounding photo while preserving original quality.
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
