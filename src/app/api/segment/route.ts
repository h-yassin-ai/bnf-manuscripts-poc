import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    let tempImage = "";
    let tempScale = "";

    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Create a dedicated temp directory for this run
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kraken-'));
        const ext = path.extname(file.name) || '.png';
        tempImage = path.join(tempDir, `image${ext}`);
        const tempJSON = path.join(tempDir, `seg.json`);

        await fs.writeFile(tempImage, buffer);

        // Command: kraken -i image.png seg.json segment -bl -d horizontal-rl -i models/muharaf.mlmodel
        const modelPath = path.join(process.cwd(), "models", "muharaf.mlmodel");

        return new Promise((resolve) => {
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
                console.log("Kraken log:", data.toString());
            });

            kraken.on("close", async (code) => {
                try {
                    if (code !== 0) {
                        resolve(NextResponse.json({ error: `Kraken failed (code ${code}): ${stderr}` }, { status: 500 }));
                        return;
                    }

                    const jsonContent = await fs.readFile(tempJSON, "utf-8");
                    const segmentation = JSON.parse(jsonContent);

                    // Clean up temp directory
                    await fs.rm(tempDir, { recursive: true, force: true });

                    resolve(NextResponse.json(segmentation));
                } catch (err: any) {
                    console.error("Cleanup/Parse Error:", err);
                    resolve(NextResponse.json({ error: `Failed to process Kraken output: ${err.message}` }, { status: 500 }));
                }
            });
        });

    } catch (error: any) {
        console.error("Segmentation Route Error:", error);
        return NextResponse.json({ error: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
