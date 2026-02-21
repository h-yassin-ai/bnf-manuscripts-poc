import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs'; // Required for child_process

const PYTHON_BRIDGE_SCRIPT = path.join(process.cwd(), 'scripts', 'transcribe_bridge.py');
const AL_KUTUB_ROOT = path.resolve(process.cwd(), '..', 'Al-Kutub-Automator');
const DEFAULT_MODEL_PATH = path.join(AL_KUTUB_ROOT, 'stt_ar_fastconformer_hybrid_large_pc_v1.0.nemo');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'transcriptions');

export async function POST(req: NextRequest) {
    try {
        const { url } = await req.json();

        if (!url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        // Ensure output dir
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        console.log(`Starting transcription for: ${url}`);
        console.log(`Script: ${PYTHON_BRIDGE_SCRIPT}`);
        console.log(`Model: ${DEFAULT_MODEL_PATH}`);

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
                ]);

                pythonProcess.stdout.on('data', (data) => {
                    const text = data.toString();
                    console.log(`[Python Output]: ${text}`);
                    safeEnqueue(encoder.encode(text));
                });

                pythonProcess.stderr.on('data', (data) => {
                    const error = data.toString();
                    console.error(`[Python stderr]: ${error}`);
                    safeEnqueue(encoder.encode(JSON.stringify({ status: "log", message: error }) + "\n"));
                });

                pythonProcess.on('close', (code) => {
                    console.log(`Python process exited with code ${code}`);
                    if (code !== 0) {
                        safeEnqueue(encoder.encode(JSON.stringify({ status: "error", code })));
                    }
                    safeClose();
                });

                pythonProcess.on('error', (err) => {
                    console.error(`Spawn error: ${err}`);
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
