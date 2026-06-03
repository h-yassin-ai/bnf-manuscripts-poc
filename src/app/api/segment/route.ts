import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";
import sharp from "sharp";

export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
    let tempDir = "";

    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const includeImages = formData.get("includeImages") === "true";

        if (!file) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Create a dedicated temp directory for this run
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kraken-'));
        const ext = path.extname(file.name) || '.png';
        const tempImage = path.join(tempDir, `image${ext}`);
        const tempJSON = path.join(tempDir, `seg.json`);

        await fs.writeFile(tempImage, buffer);

        const modelPath = path.join(process.cwd(), "models", "muharaf.mlmodel");

        return new Promise<Response>((resolve) => {
            const kraken = spawn("kraken", [
                "-i", tempImage, tempJSON,
                "segment",
                "-bl",
                "-d", "horizontal-rl",
                "-i", modelPath
            ], {
                env: {
                    ...process.env,
                    PYTHONIOENCODING: "utf-8",
                }
            });

            let stderr = "";
            kraken.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            kraken.on("close", async (code) => {
                try {
                    if (code !== 0) {
                        resolve(NextResponse.json({ error: `Kraken failed (code ${code}): ${stderr}` }, { status: 500 }));
                        return;
                    }

                    const jsonContent = await fs.readFile(tempJSON, "utf-8");
                    const segmentation = JSON.parse(jsonContent);

                    if (includeImages && segmentation.lines) {
                        const image = sharp(buffer);
                        const { width, height } = await image.metadata();

                        const linesWithImages = await Promise.all(segmentation.lines.map(async (line: any, index: number) => {
                            // Kraken returns baseline and boundary. We use boundary for cropping.
                            // Boundary is a list of points [[x,y], [x,y], ...]
                            const points = line.boundary;
                            if (!points || points.length === 0) return line;

                            const xs = points.map((p: any) => p[0]);
                            const ys = points.map((p: any) => p[1]);
                            const minX = Math.max(0, Math.min(...xs));
                            const minY = Math.max(0, Math.min(...ys));
                            const maxX = Math.min(width || 0, Math.max(...xs));
                            const maxY = Math.min(height || 0, Math.max(...ys));

                            const w = maxX - minX;
                            const h = maxY - minY;

                            if (w <= 0 || h <= 0) return line;

                            try {
                                const croppedBuffer = await image
                                    .extract({ left: Math.floor(minX), top: Math.floor(minY), width: Math.floor(w), height: Math.floor(h) })
                                    .png()
                                    .toBuffer();

                                return {
                                    ...line,
                                    id: `line_${index + 1}`,
                                    image: `data:image/png;base64,${croppedBuffer.toString("base64")}`,
                                    bbox: { x: minX, y: minY, w, h }
                                };
                            } catch (err) {
                                console.error(`Error cropping line ${index}:`, err);
                                return line;
                            }
                        }));

                        segmentation.lines = linesWithImages;
                    }

                    // Clean up temp directory
                    await fs.rm(tempDir, { recursive: true, force: true });

                    resolve(NextResponse.json(segmentation));
                } catch (err: any) {
                    console.error("Cleanup/Parse Error:", err);
                    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
                    resolve(NextResponse.json({ error: `Failed to process Kraken output: ${err.message}` }, { status: 500 }));
                }
            });
        });

    } catch (error: any) {
        console.error("Segmentation Route Error:", error);
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
        return NextResponse.json({ error: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
