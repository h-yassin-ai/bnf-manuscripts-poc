import { NextRequest, NextResponse } from "next/server";

// Removed model loading logic and Python script invocation.
// The user will handle OCR with a separate local API.

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        // TODO: Replace with fetch to local OCR API
        console.log("File received for OCR, but local model loading is removed.");

        return NextResponse.json({
            text: "OCR feature is currently detached. Please connect your local API.",
            message: "Local model loading removed as requested."
        });

    } catch (error: any) {
        console.error("OCR Route Error:", error);
        return NextResponse.json({ error: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}

