import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';

const PYTHON_BRIDGE_SCRIPT = path.join(process.cwd(), 'scripts', 'transcribe_bridge.py');
const AL_KUTUB_ROOT = process.env.AL_KUTUB_DIR || path.resolve(process.cwd(), '..', 'Al-Kutub-Automator');
const DEFAULT_MODEL_PATH = process.env.NEMO_MODEL_PATH || path.join(AL_KUTUB_ROOT, 'stt_ar_fastconformer_hybrid_large_pc_v1.0.nemo');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'transcriptions');

export async function POST(req: NextRequest) {
    try {
        const { url } = await req.json();

        if (!url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        // Check if we should delegate to the Python STT API (e.g. inside Docker/Coolify)
        const targetSttUrl = process.env.PYTHON_STT_API_URL;
        if (targetSttUrl) {
            console.log(`[Next.js STT Proxy] Delegating transcription for ${url} to host API at ${targetSttUrl}`);
            const response = await fetch(targetSttUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ url }),
            });

            if (!response.ok) {
                const err = await response.text();
                return NextResponse.json({ error: `Host STT API error: ${err}` }, { status: response.status });
            }

            if (!response.body) {
                return NextResponse.json({ error: "Empty stream returned from host STT API" }, { status: 500 });
            }

            // Return the stream directly to the client
            return new NextResponse(response.body, {
                headers: {
                    'Content-Type': 'application/x-ndjson',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        }

        // Local execution fallback (runs on Windows / direct host)
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        console.log(`[Next.js Local STT] Starting transcription for: ${url}`);
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            start(controller) {
                let isClosed = false;

                const safeEnqueue = (data: Uint8Array) => {
                    if (isClosed) return;
                    try {
                        controller.enqueue(data);
                    } catch (e) {
                        console.error("Stream enqueue failed:", e);
                    }
                };

                const safeClose = () => {
                    if (isClosed) return;
                    isClosed = true;
                    try {
                        controller.close();
                    } catch (e) {
                        console.error("Stream close failed:", e);
                    }
                };

                const pythonProcess = spawn('python', [
                    PYTHON_BRIDGE_SCRIPT,
                    '--url', url,
                    '--model', DEFAULT_MODEL_PATH,
                    '--output_dir', OUTPUT_DIR
                ], {
                    env: {
                        ...process.env,
                        PYTHONIOENCODING: "utf-8",
                    }
                });

                pythonProcess.stdout.on('data', (data) => {
                    const text = data.toString();
                    safeEnqueue(encoder.encode(text));
                });

                pythonProcess.stderr.on('data', (data) => {
                    const error = data.toString();
                    safeEnqueue(encoder.encode(JSON.stringify({ status: "log", message: error }) + "\n"));
                });

                pythonProcess.on('close', (code) => {
                    if (code !== 0) {
                        safeEnqueue(encoder.encode(JSON.stringify({ status: "error", code })));
                    }
                    safeClose();
                });

                pythonProcess.on('error', (err) => {
                    safeEnqueue(encoder.encode(JSON.stringify({ status: "error", message: err.message })));
                    safeClose();
                });
            }
        });

        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'application/x-ndjson',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error("API Route Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
