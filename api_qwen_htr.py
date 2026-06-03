import os
import gc
import base64
import io
import asyncio
import traceback
import subprocess

# Stability flags (must be set before importing torch/unsloth)
os.environ["UNSLOTH_RETURN_ANYWAY"] = "1"
os.environ["UNSLOTH_DISABLE_COMPILER"] = "1"
os.environ["TORCHDYNAMO_DISABLE"] = "1"
os.environ["TORCH_LOGS"] = "-dynamo"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["CUDA_VISIBLE_DEVICES"] = "0"

import torch
from unsloth import FastVisionModel
from PIL import Image
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

# ─── Config ──────────────────────────────────────────────────────────────────

CHECKPOINT_PATH = os.getenv("HTR_CHECKPOINT_PATH", r"j:\HTR_MAGHRIBI_DATASET\qwen2_5_vl_ocr_pipeline\outputs\htr_cot_qwen3_5_v3\checkpoint-200")
BASE_MODEL_NAME  = "unsloth/Qwen3.5-9B"  # base model identique au training (adapter_config.json)

PROMPT_TEXT = "Transcris le texte arabe de cette image :"

MAX_NEW_TOKENS = 256
MAX_PIXELS     = 602112   # ~800x750 – suffisant pour une ligne manuscrite
MIN_PIXELS     = 28 * 28 * 64

# ─── Globals ─────────────────────────────────────────────────────────────────

model     = None
processor = None


def clear_vram():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()


def load_model():
    global model, processor
    ckpt = CHECKPOINT_PATH if os.path.exists(CHECKPOINT_PATH) else BASE_MODEL_NAME
    if not os.path.exists(CHECKPOINT_PATH):
        print(f"WARNING: Checkpoint introuvable a {CHECKPOINT_PATH}. Chargement du modele de base.")
    print(f"Chargement du modele depuis : {ckpt}")
    model, processor = FastVisionModel.from_pretrained(
        model_name=ckpt,
        load_in_4bit=True,
        max_seq_length=2048,
    )
    FastVisionModel.for_inference(model)
    print("Modele pret.")


# ─── FastAPI lifespan ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    clear_vram()
    load_model()
    yield
    print("Arret - liberation VRAM...")
    global model, processor
    model = None
    processor = None
    clear_vram()


app = FastAPI(title="Qwen HTR API (QLora checkpoint-450)", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3001", "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Schemas ──────────────────────────────────────────────────────────────────

class BatchRequest(BaseModel):
    images_base64: List[str]

class LineResult(BaseModel):
    beams: List[str]
    beam_scores: List[float]

class BatchResponse(BaseModel):
    results: List[LineResult]


# ─── Inference ───────────────────────────────────────────────────────────────

def transcribe_image(pil_image: Image.Image) -> str:
    """Transcrit une image PIL en texte arabe avec Qwen2.5-VL + QLora."""
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": PROMPT_TEXT},
            ],
        }
    ]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    inputs = processor(
        text=[text],
        images=[pil_image],
        padding=True,
        return_tensors="pt",
        max_pixels=MAX_PIXELS,
        min_pixels=MIN_PIXELS,
    ).to(model.device)

    with torch.no_grad():
        generated_ids = model.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
            use_cache=True,
            do_sample=False,
            pad_token_id=processor.tokenizer.pad_token_id,
        )

    generated_ids_trimmed = [
        out[len(inp):] for inp, out in zip(inputs.input_ids, generated_ids)
    ]
    prediction = processor.batch_decode(
        generated_ids_trimmed,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )[0]

    return prediction.strip()


def process_batch(images_b64: List[str]) -> List[LineResult]:
    results = []
    for b64 in images_b64:
        # Nettoyer le header data-URL si present
        if "," in b64:
            b64 = b64.split(",")[1]
        image_data = base64.b64decode(b64)
        image = Image.open(io.BytesIO(image_data)).convert("RGB")

        text = transcribe_image(image)
        # Format identique a l'API HATFormer : une seule hypothese, score = 1.0
        results.append(LineResult(beams=[text], beam_scores=[1.0]))

    return results


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.post("/predict_batch", response_model=BatchResponse)
async def predict_batch(request: BatchRequest):
    if not request.images_base64:
        return BatchResponse(results=[])
    try:
        loop = asyncio.get_running_loop()
        line_results = await loop.run_in_executor(None, process_batch, request.images_base64)
        return BatchResponse(results=line_results)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "Qwen2.5-VL-7B QLora",
        "checkpoint": CHECKPOINT_PATH,
        "model_loaded": model is not None,
    }


class TranscribeRequest(BaseModel):
    url: str

@app.post("/transcribe")
async def transcribe(request: TranscribeRequest):
    current_dir = os.path.dirname(os.path.abspath(__file__))
    bridge_script = os.path.join(current_dir, "scripts", "transcribe_bridge.py")
    
    # Read STT paths from environment
    al_kutub_root = os.getenv("AL_KUTUB_DIR", os.path.join(os.path.dirname(current_dir), "Al-Kutub-Automator"))
    model_path = os.getenv("NEMO_MODEL_PATH", os.path.join(al_kutub_root, "stt_ar_fastconformer_hybrid_large_pc_v1.0.nemo"))
    output_dir = os.path.join(current_dir, "public", "transcriptions")

    def run_bridge():
        cmd = [
            "python", bridge_script,
            "--url", request.url,
            "--model", model_path,
            "--output_dir", output_dir
        ]
        print(f"[Host STT] Spawning: {' '.join(cmd)}")
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        for line in iter(process.stdout.readline, ""):
            yield line
        process.stdout.close()
        process.wait()

    return StreamingResponse(run_bridge(), media_type="application/x-ndjson")



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)
