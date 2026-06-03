
import sys
import os
import json
import argparse
import traceback
import yt_dlp
import time
import random
import subprocess
import re

# Add Al-Kutub-Automator to path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
PARENT_DIR = os.path.dirname(PROJECT_ROOT)
AL_KUTUB_DIR = os.getenv("AL_KUTUB_DIR", os.path.join(PARENT_DIR, "Al-Kutub-Automator"))

sys.path.append(AL_KUTUB_DIR)

try:
    from modules.transcription_engine import TranscriptionEngine
except ImportError as e:
    print(json.dumps({"error": f"Failed to import modules: {e}", "path": sys.path}), flush=True)
    sys.exit(1)

# --- Al-Kutub Helper Functions (Adapted) ---
def get_po_token_data():
    po_token_file = os.path.join(AL_KUTUB_DIR, "po_token.txt")
    po_token = None
    if os.path.exists(po_token_file):
        with open(po_token_file, "r") as f: po_token = f.read().strip()
    return po_token, None

def get_cookies_option():
    cookie_file = os.path.join(AL_KUTUB_DIR, "cookies.txt")
    if os.path.exists(cookie_file):
        print(json.dumps({"status": "log", "message": f"Using cookies from {cookie_file}"}), flush=True)
        return {'cookiefile': cookie_file}
    return {}

def progress_hook(d):
    try:
        if d['status'] == 'downloading':
            p = d.get('_percent_str', '0%').replace('%','')
            eta = d.get('_eta_str', '??:??')
            speed = d.get('_speed_str', 'N/A')
            print(json.dumps({
                "status": "downloading",
                "percent": p,
                "eta": eta,
                "speed": speed
            }), flush=True)
        elif d['status'] == 'finished':
            print(json.dumps({
                "status": "processing",
                "msg": "Conversion en cours..."
            }), flush=True)
    except Exception:
        pass

def download_video_and_audio(url, output_dir):
    po_token, _ = get_po_token_data()
    full_token = None
    if po_token:
        full_token = po_token if "+" in po_token else f"ios.gvs+{po_token}"

    ydl_opts = {
        # Priority: Best Video (mp4) + Best Audio (m4a) merged to MP4
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', 
        'outtmpl': os.path.join(output_dir, '%(id)s.%(ext)s'),
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'progress_hooks': [progress_hook],
        'user_agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'android', 'web'],
                'po_token': [full_token] if full_token else None,
            }
        },
    }
    
    ydl_opts.update(get_cookies_option())

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)
        
        # Determine actual file on disk (sometimes merge happens)
        final_video_path = filename
        base = os.path.splitext(filename)[0]
        
        # Check standard extensions if exact filename not found
        if not os.path.exists(final_video_path):
            for ext in ['.mp4', '.mkv', '.webm']:
                if os.path.exists(base + ext):
                    final_video_path = base + ext
                    break
        
        # Audio Extraction for Transcription (WAV Mono 16kHz)
        wav_path = base + ".wav"
        
        try:
            print(json.dumps({"status": "processing", "msg": "Extraction audio (mono 16kHz)..."}), flush=True)
            # Use ffmpeg to extract audio from the video file
            subprocess.run([
                'ffmpeg', '-y', 
                '-i', final_video_path, 
                '-vn', # No video
                '-ac', '1', 
                '-ar', '16000', 
                '-loglevel', 'error', 
                wav_path
            ], check=True)
        except Exception as e:
            print(json.dumps({"status": "log", "message": f"Audio extraction failed: {e}"}), flush=True)

        return wav_path, final_video_path, info.get("id")

import hashlib

# ... (imports)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="Video URL or local path")
    parser.add_argument("--model", required=True, help="Path to NeMo model")
    parser.add_argument("--output_dir", required=True, help="Output directory")
    args = parser.parse_args()

    # --- Caching Logic ---
    # Create a deterministic ID from URL
    url_hash = hashlib.md5(args.url.encode()).hexdigest()
    # Use v3 suffix to invalidate old caches (v2 might lack video_id)
    cache_file = os.path.join(args.output_dir, f"{url_hash}_v3.json")

    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            
            # Verify files still exist
            if os.path.exists(cached_data.get("video_path", "")) and os.path.exists(cached_data.get("srt_path", "")):
                # Return cached data immediately
                print(json.dumps({"status": "log", "message": "Using cached transcription..."}), flush=True)
                print(json.dumps(cached_data))
                return
        except Exception as e:
            # Cache invalid, ignore
            pass
    # ---------------------

    result = {
        "status": "pending",
        "steps": []
    }

    try:
        # 1. Download with Progress
        result["steps"].append("downloading")
        print(json.dumps({"status": "starting", "msg": f"Initiating download for {args.url}"}), flush=True)
        
        audio_path, video_path, video_id = download_video_and_audio(args.url, args.output_dir)
        
        if not audio_path or not os.path.exists(audio_path):
             # Try fallback to just video file if audio extraction failed?
             # But transcription needs audio.
             if os.path.exists(video_path):
                 print(json.dumps({"status": "log", "message": "WAV missing, trying to use video file for transcription..."}), flush=True)
                 audio_path = video_path
             else:
                 raise Exception("Failed to obtain media file")
        
        result["steps"].append("download_complete")
        
        # Return filename for frontend playback
        video_filename = os.path.basename(video_path)
        
        print(json.dumps({
            "status": "download_complete",
            "audio_path": audio_path,
            "video_path": video_path,
            "filename": video_filename 
        }), flush=True)

        # 2. Transcribe
        result["steps"].append("transcribing")
        print(json.dumps({"status": "transcribing", "msg": f"Chargement du modèle {os.path.basename(args.model)}..."}), flush=True)

        engine = TranscriptionEngine(args.model)
        
        transcription_res = engine.transcribe(
            audio_path=audio_path,
            strategy="rnnt_greedy",
            chunk_length_s=30,
            overlap_s=8
        )
        
        engine.unload()

        text_content = transcription_res[0]
        srt_content = transcription_res[1]
        timestamped_segments = transcription_res[2] if len(transcription_res) > 2 else []

        if "Error:" in text_content:
            raise Exception(text_content)

        # Save SRT to file
        # Use video_id for filename to match video file and avoid special chars
        srt_filename = f"{video_id}.srt"
        srt_path = os.path.join(args.output_dir, srt_filename)
        
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(srt_content)

        result["transcription"] = text_content
        result["segments"] = timestamped_segments
        result["srt_path"] = srt_path
        result["video_path"] = video_path # Ensure video path is sent at the end too
        result["video_id"] = video_id
        result["status"] = "success"

        # --- Save to Cache ---
        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(result, f)
        except Exception as e:
            print(json.dumps({"status": "log", "message": f"Failed to save cache: {e}"}), flush=True)
        # ---------------------

        print(json.dumps(result))

    except (yt_dlp.utils.DownloadError, yt_dlp.utils.ExtractorError) as e:
        msg = str(e).replace("ERROR: ", "").split(";")[0].strip()
        print(json.dumps({"status": "error", "error": f"Vidéo inaccessible ({msg})"}), flush=True)
        sys.exit(1)
    except Exception as e:
        err_msg = str(e) + "\n" + traceback.format_exc()
        print(json.dumps({"status": "error", "error": err_msg}))
        sys.exit(1)

if __name__ == "__main__":
    main()
