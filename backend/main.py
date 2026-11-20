from io import BytesIO
import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from gradio_client import Client, handle_file
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv

load_dotenv()


# URL of the Stable Diffusion Gradio service running on Google Colab
GRADIO_URL = os.getenv("GRADIO_URL")

if not GRADIO_URL:
    raise RuntimeError("GRADIO_URL is not configured in the .env file")

# Initialize FastAPI
app = FastAPI(title="Image Toolkit API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def decode_image(data: bytes, grayscale: bool = False):
    try:
        image = Image.open(BytesIO(data))
        image.load()
        image = image.convert("L" if grayscale else "RGB")
        return np.array(image)
    except (UnidentifiedImageError, OSError):
        raise HTTPException(
            status_code=400,
            detail="The image file is invalid or its format is unsupported.",
        )


@app.get("/health")
def health():
    return {"status": "ok", "service": "Image Toolkit API"}


@app.post("/remove-object")
async def remove_object(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    radius: int = Form(5, ge=1, le=15),
    dilation: int = Form(3, ge=0, le=10),
):

    image_data = await image.read()
    mask_data = await mask.read()

    if not image_data or not mask_data:
        raise HTTPException(
            status_code=400,
            detail="Both the image and mask must be uploaded.",
        )

    if len(image_data) > 15 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="The maximum image size is 15 MB.",
        )

    if len(mask_data) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="The maximum mask size is 5 MB.",
        )

    original = decode_image(image_data)
    mask_array = decode_image(mask_data, grayscale=True)

    height, width = original.shape[:2]

    if mask_array.shape != (height, width):
        mask_array = cv2.resize(
            mask_array,
            (width, height),
            interpolation=cv2.INTER_NEAREST,
        )
    
    # White areas indicate the objects to remove.
    binary_mask = np.where(
        mask_array > 127,
        255,
        0,
    ).astype(np.uint8)

    if not np.any(binary_mask):
        raise HTTPException(
            status_code=400,
            detail="The mask is empty. Select an object first.",
        )

    # Expand the mask to include some of the object edges.
    if dilation > 0:
        kernel_size = (dilation * 2) + 1
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (kernel_size, kernel_size),
        )
        binary_mask = cv2.dilate(
            binary_mask,
            kernel,
            iterations=1,
        )

    # Convert RGB to BGR for OpenCV.
    original_bgr = cv2.cvtColor(
        original,
        cv2.COLOR_RGB2BGR,
    )

    # Run inpainting.
    result = cv2.inpaint(
        original_bgr,
        binary_mask,
        float(radius),
        cv2.INPAINT_TELEA,
    )

    # Convert back to RGB.
    result = cv2.cvtColor(
        result,
        cv2.COLOR_BGR2RGB,
    )

    output = BytesIO()
    Image.fromarray(result).save(output, format="PNG")

    return Response(
        content=output.getvalue(),
        media_type="image/png",
        headers={
            "Content-Disposition": 'inline; filename="result.png"'
        },
    )


@app.post("/remove-object-ai")
async def remove_object_ai(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    mode: str = Form("remove"),
):
    image_data = await image.read()
    mask_data = await mask.read()

    if not image_data or not mask_data:
        raise HTTPException(
            status_code=400,
            detail="Both the image and mask must be uploaded.",
        )

    if len(image_data) > 15 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="The maximum image size is 15 MB.",
        )

    if len(mask_data) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="The maximum mask size is 5 MB.",
        )

    original = decode_image(image_data)
    mask_array = decode_image(mask_data, grayscale=True)

    height, width = original.shape[:2]

    if mask_array.shape != (height, width):
        mask_array = cv2.resize(
            mask_array,
            (width, height),
            interpolation=cv2.INTER_NEAREST,
        )

    binary_mask = np.where(
        mask_array > 127, 255, 0
    ).astype(np.uint8)

    if not np.any(binary_mask):
        raise HTTPException(
            status_code=400,
            detail="The mask is empty. Select an object first.",
        )

    if mode != "remove":
        raise HTTPException(
            status_code=400,
            detail="Invalid processing mode.",
        )
    
    with tempfile.TemporaryDirectory() as temp_dir:
        image_path = Path(temp_dir) / "input.png"
        mask_path = Path(temp_dir) / "mask.png"

        Image.fromarray(original).save(image_path)
        Image.fromarray(binary_mask).save(mask_path)

        def call_gradio():
            client = Client(GRADIO_URL, verbose=False)

            return client.predict(
                handle_file(str(image_path)),
                handle_file(str(mask_path)),
                mode,
                api_name="/run_inpainting",
            )

        try:
            result_path = await run_in_threadpool(call_gradio)

            if isinstance(result_path, dict):
                result_path = result_path.get("path")

            if isinstance(result_path, (list, tuple)):
                result_path = result_path[0]

            if not result_path:
                raise RuntimeError(
                    "Gradio did not return an output file."
                )

            with Image.open(result_path) as result_image:
                output = BytesIO()
                result_image.convert("RGB").save(
                    output, format="PNG"
                )

            return Response(
                content=output.getvalue(),
                media_type="image/png",
                headers={
                    "Content-Disposition":
                        'inline; filename="result-ai.png"'
                },
            )

        except Exception as exc:
            print(f"[AI Inpainting Error] {type(exc).__name__}: {exc}")

            raise HTTPException(
                status_code=502,
                detail=(
                    "The AI service is currently unavailable. "
                    "Make sure the Google Colab session is active and try again, "
                    "or use OpenCV Telea."
                ),
            )