import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { NextRequest, NextResponse } from "next/server";

// Initialize DeepSeek provider
const deepseek = createOpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
});

export async function POST(req: NextRequest) {
    try {
        const { messages, text } = await req.json();

        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "DEEPSEEK_API_KEY is not set" },
                { status: 500 }
            );
        }

        // Default System Prompt
        let systemPrompt = `Tu es un expert en manuscrits anciens (arabe, persan).
Tâche principale : Aider à la vocalisation (Tashkeel) ou à la correction orthographique/grammaticale de textes transcrits.
Réponds toujours de manière concise et utile.`;

        if (text) {
            systemPrompt += `\n\nVoici le texte du manuscrit en cours d'analyse :\n"${text}"`;
        }

        const result = await streamText({
            model: deepseek.chat("deepseek-chat"),
            system: systemPrompt,
            messages: messages,
            temperature: 0.3,
        });

        return result.toUIMessageStreamResponse();

    } catch (error: any) {
        console.error("DeepSeek API Handler Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
