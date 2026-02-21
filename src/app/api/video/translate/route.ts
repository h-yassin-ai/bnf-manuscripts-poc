import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

// Helper to format SRT
function formatSrt(segments: any[]) {
    return segments.map((seg, i) => {
        const start = formatTimestamp(seg.start);
        const end = formatTimestamp(seg.end);
        return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    }).join('\n');
}

function formatTimestamp(seconds: number) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const iso = date.toISOString();
    return iso.substr(11, 8) + ',' + iso.substr(20, 3);
}

export async function POST(req: NextRequest) {
    try {
        const { video_id, segments } = await req.json();

        console.log(`[Translate API] Received request for video_id: ${video_id}, segments: ${segments?.length}`);

        if (!video_id || !segments) {
            console.error("[Translate API] Missing video_id or segments");
            return NextResponse.json({ error: "Missing video_id or segments" }, { status: 400 });
        }

        const outputDir = path.join(process.cwd(), 'public', 'transcriptions');

        // Ensure directory exists
        if (!fs.existsSync(outputDir)) {
            console.log("[Translate API] Creating output directory:", outputDir);
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Ensure filenames usage the video_id prefix to match what the downloader produces
        const frSrtFilename = `${video_id}.fr.srt`;
        const frSrtPath = path.join(outputDir, frSrtFilename);
        const cacheFile = path.join(outputDir, `${video_id}.fr.json`);

        console.log(`[Translate API] Paths set. CACHE: ${cacheFile}, SRT: ${frSrtPath}`);

        // 1. Check Cache
        if (fs.existsSync(cacheFile) && fs.existsSync(frSrtPath)) {
            console.log("[Translate API] Returning cached translation:", cacheFile);
            const cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            return NextResponse.json(cachedData);
        }

        console.log("[Translate API] Translating segments for:", video_id);

        // 2. Prepare for DeepSeek
        // We'll translate in chunks if necessary, but for now let's try one big batch 
        // if it fits context. For safety, let's map text only.
        const textToTranslate = segments.map((s: any) => s.text).join(" ||| ");

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    {
                        role: "system",
                        content: "You are a professional translator. Translate the following Arabic text to French. The text is segments of a video transcript separated by ' ||| '. Keep the ' ||| ' separators exactly where they are so I can split them back. Do not add any introduction or conclusion, just the translated text."
                    },
                    {
                        role: "user",
                        content: textToTranslate
                    }
                ],
                temperature: 0.3
            })
        });

        console.log("[Translate API] DeepSeek Status:", response.status);

        if (!response.ok) {
            const err = await response.text();
            console.error("[Translate API] DeepSeek API Error Body:", err);
            return NextResponse.json({ error: "Translation API failed" }, { status: 500 });
        }

        const aiData = await response.json();
        console.log("[Translate API] DeepSeek Response received. Choices:", aiData.choices?.length);
        const translatedFullText = aiData.choices[0].message.content;

        // 3. Reconstruct Segments
        const translatedSpecificSegments = translatedFullText.split("|||");

        // Handle potential mismatch in length (robustness)
        const newSegments = segments.map((seg: any, i: number) => ({
            ...seg,
            text: (translatedSpecificSegments[i] || seg.text).trim()
        }));

        // 4. Generate SRT
        const srtContent = formatSrt(newSegments);
        fs.writeFileSync(frSrtPath, srtContent, 'utf-8');

        // 5. Save Cache
        const result = {
            status: 'success',
            segments: newSegments,
            srt_path: frSrtPath,
            video_id: video_id
        };
        fs.writeFileSync(cacheFile, JSON.stringify(result), 'utf-8');

        return NextResponse.json(result);

    } catch (error: any) {
        console.error("Translation error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
