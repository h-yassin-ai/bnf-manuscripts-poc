"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/PageHeader";

const ManuscriptWorkbench = dynamic(() => import("@/components/ManuscriptWorkbench"), {
    ssr: false,
    loading: () => (
        <div className="flex-1 flex items-center justify-center bg-stone-50 rounded-lg border-2 border-dashed border-stone-200">
            <div className="text-stone-400 animate-pulse font-serif italic text-lg text-center">
                Chargement de l'atelier de manuscrit...
            </div>
        </div>
    )
});

export default function ManuscritPage() {
    return (
        <div className="flex flex-col h-screen bg-[#FDFCF8]">
            <PageHeader title="Atelier Manuscrit - Transcription & Segmentation" />
            <main className="flex-1 overflow-hidden p-4 flex flex-col">
                <ManuscriptWorkbench />
            </main>
        </div>
    );
}
