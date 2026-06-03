import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        
        // Retrieve Python HTR URL from environment (configured in .env.local on VPS/local)
        const targetUrl = process.env.PYTHON_HTR_API_URL || "http://127.0.0.1:8001/predict_batch";
        
        console.log(`[Next.js HTR Proxy] Forwarding request to ${targetUrl}`);
        
        const response = await fetch(targetUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`[Next.js HTR Proxy] Backend returned error: ${err}`);
            return NextResponse.json({ error: `Python HTR API error: ${err}` }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[Next.js HTR Proxy Error]:", error);
        return NextResponse.json({ error: error.message || "Failed to contact Python HTR API" }, { status: 500 });
    }
}
