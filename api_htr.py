import base64
import io
import asyncio
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from PIL import Image
import torch
import torchvision.transforms as T
from transformers import VisionEncoderDecoderModel, PreTrainedTokenizerFast

# Paths to the model and tokenizer (Absolute paths to your training folder)
import os

MODEL_DIR = os.getenv("HATFORMER_MODEL_PATH", r"j:\HTR_MAGHRIBI_DATASET\HATFormer\HATFormer\best_model_hf")
TOKENIZER_FILE = os.getenv("HATFORMER_TOKENIZER_PATH", r"j:\HTR_MAGHRIBI_DATASET\HATFormer\HATFormer\arabic_tokenizer_clean\tokenizer.json")

NUM_BEAMS = 5
NUM_RETURN_SEQUENCES = 3

# Global references to models on different GPUs
models = []
tokenizer = None
current_gpu_idx = 0

transform = T.Compose([
    T.ToTensor(),
    T.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
])

def preprocess_image(img: Image.Image) -> torch.Tensor:
    """Exact preprocessing logic used during training to ensure 33% CER."""
    # Handle transparent PNGs from web canvases
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[3])
        img = background
    else:
        img = img.convert("RGB")
        
    original_width, original_height = img.size

    new_height = 64
    aspect_ratio = original_width / original_height
    new_width = int(new_height * aspect_ratio)

    resized_img = img.resize((new_width, new_height))
    flipped_img = resized_img.transpose(Image.FLIP_LEFT_RIGHT)
    resized_img = flipped_img

    final_width, final_height = 384, 384
    new_img = Image.new("RGB", (final_width, final_height), (0, 0, 0))

    if resized_img.width <= final_width:
        new_img.paste(resized_img, (0, 0))
    else:
        segment_width = final_width
        num_segments = (resized_img.width + segment_width - 1) // segment_width
        for i in range(num_segments):
            left = i * segment_width
            right = min(left + segment_width, resized_img.width)
            segment = resized_img.crop((left, 0, right, new_height))
            new_img.paste(segment, (0, i * new_height))

    pixel_values = transform(new_img)
    return pixel_values


@asynccontextmanager
async def lifespan(app: FastAPI):
    global models, tokenizer
    print("Loading tokenizer...")
    tokenizer = PreTrainedTokenizerFast(tokenizer_file=TOKENIZER_FILE)
    tokenizer.add_special_tokens({'pad_token': '<pad>', 'eos_token': '</s>', 'cls_token': '<s>', 'bos_token': '<s>'})

    print("Detecting GPUs...")
    num_gpus = torch.cuda.device_count()
    if num_gpus == 0:
        print("WARNING: No GPUs detected. Loading on CPU (will be slow).")
        model = VisionEncoderDecoderModel.from_pretrained(MODEL_DIR).eval()
        models.append(model)
    else:
        print(f"Detected {num_gpus} GPUs. Loading model across available GPUs for load balancing...")
        # Since u said 2x3090, we load one copy of the model on each GPU
        for i in range(num_gpus):
            print(f"Loading model instance on cuda:{i}...")
            model = VisionEncoderDecoderModel.from_pretrained(MODEL_DIR).to(f"cuda:{i}").eval()
            models.append(model)

    print("API is ready to accept requests.")
    yield
    print("Shutting down API and releasing VRAM...")
    models.clear()
    torch.cuda.empty_cache()


app = FastAPI(title="HATFormer HTR API", lifespan=lifespan)

# Allow cross-origin requests from Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BatchRequest(BaseModel):
    images_base64: List[str]

class LineResult(BaseModel):
    beams: List[str]
    beam_scores: List[float]

class BatchResponse(BaseModel):
    results: List[LineResult]


def get_next_model():
    """Round-robin load balancing across available models/GPUs."""
    global current_gpu_idx
    model = models[current_gpu_idx]
    current_gpu_idx = (current_gpu_idx + 1) % len(models)
    return model


@torch.no_grad()
def generate_batch_with_beams(model, pixel_values_tensor):
    """
    Run beam search returning NUM_RETURN_SEQUENCES candidates per image
    plus their sequence-level log-probability scores.
    """
    device = model.device
    pixel_values_tensor = pixel_values_tensor.to(device)
    batch_size = pixel_values_tensor.size(0)

    outputs = model.generate(
        pixel_values_tensor,
        num_beams=NUM_BEAMS,
        num_return_sequences=NUM_RETURN_SEQUENCES,
        length_penalty=0.6,
        max_new_tokens=450,
        output_scores=True,
        return_dict_in_generate=True,
        repetition_penalty=1.5,
        no_repeat_ngram_size=4,
        early_stopping=True
    )

    # Decode all sequences (shape: batch_size * NUM_RETURN_SEQUENCES)
    all_texts = tokenizer.batch_decode(outputs.sequences, skip_special_tokens=True)

    # sequences_scores: log-probs, shape [batch_size * NUM_RETURN_SEQUENCES]
    raw_scores = outputs.sequences_scores.cpu().tolist()

    results = []
    for img_idx in range(batch_size):
        start = img_idx * NUM_RETURN_SEQUENCES
        end = start + NUM_RETURN_SEQUENCES
        beams = all_texts[start:end]
        log_scores = raw_scores[start:end]

        # Convert log-probs to 0–1 confidence via softmax over the candidates
        import math
        max_log = max(log_scores)
        exp_scores = [math.exp(s - max_log) for s in log_scores]
        total = sum(exp_scores)
        norm_scores = [round(e / total, 4) for e in exp_scores]

        results.append(LineResult(beams=beams, beam_scores=norm_scores))

    return results


@app.post("/predict_batch", response_model=BatchResponse)
async def predict_batch(request: BatchRequest):
    try:
        if not request.images_base64:
            return BatchResponse(results=[])

        # 1. Decode & preprocess images
        pixel_values_list = []
        for b64 in request.images_base64:
            if "," in b64:
                b64 = b64.split(",")[1]
            image_data = base64.b64decode(b64)
            image = Image.open(io.BytesIO(image_data))
            pv = preprocess_image(image)
            pixel_values_list.append(pv)

        batch_tensor = torch.stack(pixel_values_list)

        # 2. Pick next GPU model
        model = get_next_model()

        # 3. Run generation in thread-pool (avoid blocking async event loop)
        loop = asyncio.get_running_loop()
        line_results = await loop.run_in_executor(
            None, generate_batch_with_beams, model, batch_tensor
        )

        return BatchResponse(results=line_results)

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok", "models_loaded": len(models)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
