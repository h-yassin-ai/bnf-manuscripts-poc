import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy for LM Studio Vision API.
 * LM Studio follows OpenAI-compatible Chat Completions API.
 */
export async function POST(req: NextRequest) {
    try {
        const { imageBase64, lineId, mode } = await req.json();

        if (!imageBase64) {
            return NextResponse.json({ error: "No image data" }, { status: 400 });
        }

        console.log(`[OCR Proxy] Mode: ${mode}, Size: ${Math.round(imageBase64.length / 1024)} KB, Prefix: ${imageBase64.substring(0, 50)}...`);

        const isFullPage = mode === 'full';
        const instruction = isFullPage
            ? "Transcribe this full manuscript page. Maintain the original line structure as much as possible."
            : "Transcribe this manuscript line.";

        // Prepare body for LM Studio (OpenAI format)
        const body = {
            model: "arabic-english-handwritten-ocr-v3@q6_k",
            messages: [
                {
                    role: "system",
                    content: "You are an OCR expert. Transcribe the Arabic text shown in the image. Return ONLY the transcribed text, nothing else."
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text", text: `${instruction} 
Here is a reference text that might match the content. Use it to correct your OCR if it matches:
" مجمع على فساده فلا ارث له و المراد بالاجماع اجماع الامة كلها الا من لا يعبوا به و عن
من قولنا عن فسخه بمعنى على و هو مستعمل في اشعار العرب كثيرا
و حيثما طلقها في الصحة رجعية توارثا في العدة
لا شك ان الطلاق الرجعي لا يرفع احكام الزوجية من انفاق و توارث و لزوم طلاق
و انتقال الى عدة وفات الا الاستمتاع و المراد بالرجعي ما لم يرفع بعوض  و لابت و لا
قبل البناء و حكم حاكم في غير الاعسار و الايلاء و سبك البيت و حيثما
طلق الزوج زوجته و هو صحيح طلقة رجعية فانهما يتوارثان ما دامت في
العدة فان انقضت لم يتوارثا فان قلت ما فائدة تقييده بالصحة اليس
التوارث باقيا حتى لو وقع الرجعي في المرض قلت فائدة التقييد
بالعدة فلو لا قيد الصحة لاوهم ان زوجة المريض لا ترثه في الطلاق الرجعي الا
في العدة و قولنا في الصحة في موضع الحال من ضمير الزوج في طلقها لا من ضمير
الزوجة فصل اذا اتت ام الفتى بولد من رجل من بعده مستبعد
ان وضعته قبل ست اشهر يرث و حيت لا يمنعه حر
ذكر في هذا الفصل مسئلة حسنة من مسائل الشك و كان حقها ان تذكر في باب
الموانع او تترك لانها جزئية من جزئيات الشك و صورة من صوره التي لا تنحصر ###
لاكن لما كانت اكثرية الوقوع مغفولا عن حكمها راينا ان نفرد لها فصلا و صورتها
ان يموت انسان عن غير ولد و لا من يحجب الاخوة للام و يترك امه متزوجة عند رجل
فتاتي بولد بعد موت انها هذا فاتفق العلماء على ان هذا ان وضع لستة اشهر
فاكثر من يوم موت اخيه لم يرث لاحتمال طروه بعد موت اخيه و لا ميراث بشك
الا ان يصدقها انها كانت حاملا يوم موته او تشهد به امراتان فصعدا و ان
و ان وضعته لاقل من ذلك ورث اذ لا يكون الحمل اقل من ذلك فتعين ان يكون موجودا حين
موته و هذه المسئلة مذكورة في كتاب العتق الثاني من المدونة و عن علي بن ابي طالب
و عمر ابن عبد العزيز رضي الله عنهما ان زوج هذه المراة يعزل عنها حتى يستبريها
بحيضة ليعلم اهي حامل ام لا احتياطا للميراث  تنبيهان الاول ما ذكرناه
من التفصيل مقيد بما اذا كان الزوج حيا حاضرا بعد موت الولد و اما ان ما قبله "
` },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageBase64 // Expecting 'data:image/png;base64,...'
                            }
                        }
                    ]
                }
            ],
            temperature: 0.1,
            max_tokens: 500
        };

        const response = await fetch("http://localhost:1234/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LM Studio error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const transcribedText = data.choices[0]?.message?.content || "";

        return NextResponse.json({
            lineId,
            text: transcribedText.trim()
        });

    } catch (error: any) {
        console.error("OCR Proxy Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
