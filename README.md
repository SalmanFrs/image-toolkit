# Image Toolkit

![Next.js](https://img.shields.io/badge/NEXT.JS%2016-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/REACT%2019-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TYPESCRIPT%205-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/TAILWIND%20CSS%204-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![ONNX Runtime Web](https://img.shields.io/badge/ONNX%20RUNTIME%20WEB-005CED?style=for-the-badge&logo=onnx&logoColor=white)
![WebAssembly](https://img.shields.io/badge/WEBASSEMBLY-654FF0?style=for-the-badge&logo=webassembly&logoColor=white)
![Vercel](https://img.shields.io/badge/VERCEL-000000?style=for-the-badge&logo=vercel&logoColor=white)

> **A 100% private, client-side image manipulation and AI studio running entirely in your browser with zero backend requirements.**

🔗 **Live Demo:** [https://image-toolkit-studio.vercel.app/](https://image-toolkit-studio.vercel.app/)  
📁 **Repository:** [https://github.com/SalmanFrs/image-toolkit](https://github.com/SalmanFrs/image-toolkit)

---

## 🌟 Overview

**Image Toolkit** is a pure, zero-backend edge application for everyday image editing, format conversion, and state-of-the-art AI object removal. 

- **100% Client-Side Privacy**: All processing occurs locally within the user's browser via HTML5 Canvas, WebAssembly (WASM), and browser APIs. No photos or media files are ever uploaded to any external server.
- **In-Browser Deep Learning (LaMa ONNX)**: Eliminates the need for expensive Python servers or cloud GPU clusters by executing the Large Mask Inpainting (LaMa) model directly in the browser via `onnxruntime-web`.
- **Persistent Local AI Caching**: Models are streamed once (~198 MB) and cached in the browser's native `Cache API`, enabling instantaneous offline-ready processing on subsequent uses with clear cache-status indicators.
- **High-Resolution Smart ROI Compositing**: Eliminates blurry upscaling by automatically isolating stroke clusters, running localized 512×512 inpainting on square ROIs, and blending seamless feathered patches back onto the full original HD canvas.
- **Non-Intrusive Toast Feedback**: Lightweight, zero-dependency toast notification system (`fixed bottom-4 right-4`) delivering instant status updates across all processing, cancellation, and download events.
- **Consistent Output Naming**: All processed exports are uniformly saved with the `{originalName}-{featureName}-result.{ext}` pattern.

---

## 🚀 Key Features

### 1. 🪄 AI Object Remover (LaMa Inpainting)

Remove unwanted objects, watermarks, text, or photo-bombers with an intelligent brush masking interface running entirely in-browser.

- **Interactive Selection Brush**: Adjustable brush size slider (5 px – 150 px), stroke counter, multi-step undo, clear canvas, and binary mask PNG export.
- **Dedicated Background Web Worker**: Runs WASM inference in an isolated thread (`ort.env.wasm.proxy = true`) preventing UI freezes or browser "Page Unresponsive" warnings.
- **Multi-Region & Cluster Detection**: Employs downsampled 128×128 connected-component clustering (BFS). Distinct, distant markings (such as logos in opposite corners) are automatically isolated and sequentially inpainted without downsampling the whole image.
- **Smart ROI & Feathered Compositing**: Restricts inpainting to square padded patches around each mask cluster, applying a 2px feathered alpha mask so surrounding HD pixels remain 100% untouched.
- **Real-Time UX Telemetry & Cancel Support**: Features real-time download progress with MB counter and completion percentage, a phase-based stepper (Download -> Load AI -> Prepare -> Infer -> Compose), a pulsing scanline overlay, and instant user cancellation support powered by `AbortController`.
- **Interactive Visual Comparison**:
  - **Split-Screen Slider**: Smooth horizontal before/after draggable divider to inspect boundaries.
  - **Before / After Mode**: Synchronized viewports for direct before/after comparison on desktop and mobile.
- **Standardized Export**: Saves directly as `{fileName}-object-remover-result.{ext}` matching the original input format (PNG, JPG, or WebP).

### 2. 📐 Smart Image Resizer

High-fidelity client-side image scaling designed for speed and web optimization.

- **Custom Dimensions**: Scale up to 12,000 px with instant aspect-ratio locking or freeform dimensions.
- **Multi-Format Export**: Convert seamlessly across **PNG**, **JPG**, and **WebP** with auto-detection of the uploaded format.
- **Quality & Compression Controls**: Granular compression quality slider for lossy formats (JPG/WebP) with clean background fills.
- **Real-Time Output Preview**: Inspect resulting output image dimensions, visual sharpness, and calculated byte size before downloading.
- **Standardized Export**: Saves directly as `{fileName}-resized-result.{ext}`.

### 3. ✂️ Interactive Image Cropper

Crop, reframe, and orient images with sub-pixel precision powered by `react-easy-crop`.

- **8 Aspect Ratio Presets**: Choose between **Original**, **1:1 (Square)**, **4:3**, **16:9 (Widescreen)**, **3:2**, **2:3 (Portrait)**, **3:4**, and **9:16 (Stories/Reels)**, or freeform cropping.
- **Accidental Rotation Prevention on Mobile**: Pinch gesture is strictly restricted to zoom in/out with bounded positions, while canvas rotation is deliberately controlled via 90° clockwise/counter-clockwise buttons.
- **Bounded Canvas Clamping**: Clamps crop boundaries to prevent white background margins in export.
- **Live Output Telemetry**: Live display of cropped pixel width/height and crop coordinate telemetry.
- **Preview & Format Export**: Dedicated full-resolution preview with output format selection (PNG/JPG/WebP).
- **Standardized Export**: Saves directly as `{fileName}-cropped-result.{ext}`.

### 4. 📦 Batch Format Converter

Convert and compress image collections in parallel entirely within the user's browser.

- **Multi-File Queue**: Drag and drop up to 20 images simultaneously (max 15 MB per file).
- **Client-Side Bulk Conversion**: Rapid parallel rasterization to PNG, JPG, or WebP with global compression quality tuning.
- **Storage Metrics**: Direct comparison showing original vs. converted byte sizes and percentage saved.
- **Flexible Downloads**: Download individual converted files as `{fileName}-converted-result.{ext}` or package the entire batch into a single archive (`image-toolkit-converted.zip`) on the fly using `JSZip`.

### 5. ⚡ Client-Side Image Compressor

Intelligent browser-based compression balancing file size reduction with visual clarity.

- **High-Capacity File Support**: Accommodates files up to 30 MB (PNG, JPG, or WebP) directly in the client.
- **Dual Compression Modes**:
  - **Quality Slider & Quick Presets**: Precise 10% - 100% tuning with one-click presets: High Quality (85%), Balanced (75%), and Maximum Compression (50%).
  - **Target File Size Search with Progressive Fallback**: Automatic binary search iteration to achieve a target maximum file size in KB, with progressive dimension scaling fallback for lossless PNGs and ultra-high-resolution images (5000px+).
- **Smart Format Auto-Detection**: Converts or retains formats across JPG, WebP, and PNG with auto-detection on upload.
- **Optional Max Dimension Scaling**: Optional downscaling for additional byte savings (e.g. 1920px).
- **Live Visual Comparison Slider**: Interactive before/after split slider allowing users to inspect sharpness before saving.
- **Standardized Export**: Saves directly as `{fileName}-compressed-result.{ext}`.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    User["User Browser (Client)"]

    subgraph ClientStudio["Image Toolkit Studio (100% Client-Side)"]
        UI["Next.js App Router + React 19 UI"]
        Resizer["Image Resizer (HTML5 Canvas 2D)"]
        Cropper["Image Cropper (react-easy-crop)"]
        Compressor["Image Compressor (HTML5 Canvas 2D)"]
        Batch["Batch Converter (createImageBitmap + JSZip)"]
        Toast["Toast Notification System"]
        
        subgraph EdgeAI["Edge AI Inpainting Engine"]
            Cache["Browser Cache API (image-toolkit-ai-models-v1)"]
            Worker["Background Web Worker (ort.env.wasm.proxy)"]
            LaMa["LaMa ONNX Model (Float32 / 512x512)"]
            ROI["Smart ROI Clustering & Feathered Compositor"]
        end
    end

    RemoteCDN["HuggingFace CDN / Public Storage"]

    User -->|"Paint Mask / Resize / Crop / Compress / Convert"| UI
    UI -->|"Canvas Scaling & Export"| Resizer
    UI -->|"Cropping & Orientation"| Cropper
    UI -->|"Quality Tuning & Search"| Compressor
    UI -->|"Batch Processing & Zip"| Batch
    UI -->|"Status Feedback & Alerts"| Toast
    
    UI -->|"Execute Inpaint"| ROI
    ROI -->|"Check / Load Model"| Cache
    Cache -.->|"First-time Download Stream"| RemoteCDN
    ROI -->|"Offload 512x512 Tensors"| Worker
    Worker -->|"Execute WASM Inference"| LaMa
    LaMa -->|"Inpainted Patch"| ROI
    ROI -->|"Feathered HD Composite"| UI
    UI -->|"Direct PNG/JPG/WebP Download"| User
```

---

## 💻 Tech Stack Breakdown

| Technology | Role & Highlights |
| :--- | :--- |
| **Next.js 16 (App Router)** | React 19 framework providing optimized client-side hydration, fast routing, and clean component architecture. |
| **TypeScript 5** | Strict type safety across image pipelines, bounding box geometry, and ONNX tensor interfaces. |
| **Tailwind CSS v4** | Dark-themed styling, micro-animations (shimmer, scanline), and mobile-responsive layout. |
| **ONNX Runtime Web (`onnxruntime-web`)** | WebAssembly execution provider with background worker proxy for client-side deep learning inference. |
| **LaMa (Large Mask Inpainting)** | State-of-the-art fast Fourier convolution (FFC) architecture for resolution-independent structural inpainting. |
| **HTML5 Canvas 2D** | Hardware-accelerated image scaling, drawing, mask dilation, and feathered compositing. |
| **react-easy-crop** | High-performance touch and mouse cropping with customizable aspect ratios and rotation. |
| **JSZip** | In-browser client-side archive generation for batch image downloads. |

---

## 📂 Project Structure

```text
image-toolkit/
├── app/
│   ├── components/
│   │   ├── BatchConverter.tsx   # Multi-file format converter & ZIP packager
│   │   ├── ImageCompressor.tsx  # Browser-based image compression & target size search
│   │   ├── ImageCropper.tsx     # Crop & rotation tool using react-easy-crop
│   │   ├── ImageEditor.tsx      # Inpainting mask brush, progress UI & comparison views
│   │   ├── ImageResizer.tsx     # Image scaling & format compression
│   │   └── Toast.tsx            # Zero-dependency toast notification viewport & hook
│   ├── lib/
│   │   └── lamaInpaint.ts       # ONNX Runtime Web engine, streaming Cache API & ROI compositor
│   ├── favicon.ico
│   ├── globals.css              # Global styles, shimmer & scanline keyframes
│   ├── layout.tsx               # Root layout and metadata
│   └── page.tsx                 # Studio navigation & tool state
├── public/                      # Static assets and icons
├── .env.example                 # Optional environment configuration
├── .gitignore                   # Git ignore rules for Next.js & node_modules
├── eslint.config.mjs            # ESLint configuration
├── LICENSE                      # MIT License
├── next.config.ts               # Next.js configuration
├── package.json                 # Node.js dependencies and scripts
├── README.md                    # Project documentation
└── tsconfig.json                # TypeScript compiler configuration
```

---

## 🛠️ Getting Started (Local Setup)

### Prerequisites

- **Node.js**: version 20+ (recommended 22+)
- **npm** (comes with Node.js)

### Installation & Run

1. Clone the repository:
   ```bash
   git clone https://github.com/SalmanFrs/image-toolkit.git
   cd image-toolkit
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. *(Optional)* Configure a custom LaMa model URL:
   Copy `.env.example` to `.env.local` if you wish to host the ONNX model on a custom CDN or self-hosted endpoint:
   ```bash
   cp .env.example .env.local
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🚀 Deployment

Because Image Toolkit is **100% client-side**, it can be deployed with zero backend infrastructure to any static hosting provider or modern edge platform:

- **Vercel**: Import the repository and deploy with default Next.js settings.
- **Netlify / Cloudflare Pages / GitHub Pages**: Deploy using standard Next.js build commands (`npm run build`).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
