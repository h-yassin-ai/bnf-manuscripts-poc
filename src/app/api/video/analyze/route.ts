import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const deepseek = createOpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
});

export async function POST(req: NextRequest) {
    try {
        const { text, type, targetLang = 'fr' } = await req.json();

        if (!text) {
            return NextResponse.json({ error: "Text is required" }, { status: 400 });
        }

        let systemPrompt = "";
        let userPrompt = "";

        if (type === 'translation') {
            systemPrompt = `You are a professional translator specializing in historical and academic texts. Translate the following text into ${targetLang === 'fr' ? 'French' : targetLang}. Maintain the tone and accuracy of the original content.`;
            userPrompt = text;
        } else if (type === 'summary') {
            systemPrompt = "You are an academic researcher. Provide a comprehensive summary of the following transcription. Highlight key themes, historical context, and significant arguments. Structure the summary with clear headings.";
            userPrompt = text;
        } else {
            return NextResponse.json({ error: "Invalid type" }, { status: 400 });
        }

        const { text: result } = await generateText({
            model: deepseek('deepseek-chat'),
            system: systemPrompt,
            prompt: userPrompt,
        });

        return NextResponse.json({ result });

    } catch (error: any) {
        console.error("Analysis API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
