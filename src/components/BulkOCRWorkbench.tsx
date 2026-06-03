"use client";

import React, { useState } from "react";
import { pdfToImages } from "../lib/pdfUtils";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Upload, Languages, FileDown, Loader2, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "./ui/progress";
import { ScrollArea } from "./ui/scroll-area";
import JSZip from "jszip";

import ManuscriptChatbot from "./ManuscriptChatbot";
import { Separator } from "./ui/separator";

export default function BulkOCRWorkbench() {
    const [images, setImages] = useState<string[]>([]);
    const [transcriptions, setTranscriptions] = useState<Record<number, string>>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentPage, setCurrentPage] = useState(0);

    // Font controls
    const [fontSize, setFontSize] = useState(22);
    const [fontFamily, setFontFamily] = useState("font-scheherazade");
    const [lineSpacing, setLineSpacing] = useState(1.5);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsProcessing(true);
        try {
            if (file.type === "application/pdf") {
                const imgDataUrls = await pdfToImages(file);
                setImages(imgDataUrls);
            } else {
                const reader = new FileReader();
                reader.onload = (event) => {
                    if (event.target?.result) setImages([event.target.result as string]);
                };
                reader.readAsDataURL(file);
            }
            setTranscriptions({});
            setProgress(0);
            setCurrentPage(0);
            toast.success("Document chargé");
        } catch (error) {
            console.error(error);
            toast.error("Erreur de chargement");
        } finally {
            setIsProcessing(false);
        }
    };

    const runBulkOCR = async () => {
        if (images.length === 0) return;

        setIsProcessing(true);
        setProgress(0);
        // const newTranscriptions: Record<number, string> = {}; // Removed as state is updated progressively

        try {
            for (let i = 0; i < images.length; i++) {
                // Update progress
                // setProgress(Math.round(((i) / images.length) * 100)); // Updated to i+1 for correct progress

                const response = await fetch("/api/ocr-proxy", {
                    method: "POST",
                    body: JSON.stringify({
                        imageBase64: images[i],
                        mode: "full"
                    })
                });

                if (!response.ok) throw new Error(`Erreur page ${i + 1}`);

                const data = await response.json();
                // newTranscriptions[i] = data.text || ""; // Removed

                // Update state progressively
                setTranscriptions(prev => ({ ...prev, [i]: data.text || "" }));
                setProgress(Math.round(((i + 1) / images.length) * 100));
            }
            // setProgress(100); // Handled by the loop now
            toast.success("OCR terminé pour toutes les pages");
        } catch (error: any) {
            console.error(error);
            toast.error(`Échec de l'OCR: ${error.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleExport = () => {
        const fullText = images.map((_, i) => `--- PAGE ${i + 1} ---\n${transcriptions[i] || ""}`).join("\n\n");
        const blob = new Blob([fullText], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "transcription_complete.txt";
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleTranscriptionExport = async () => {
        if (images.length === 0) return;

        setIsProcessing(true);
        setProgress(0);
        const zip = new JSZip();

        try {
            for (let i = 0; i < images.length; i++) {
                setProgress(Math.round((i / images.length) * 100));

                // 1. Get the page image as a blob
                const pageRes = await fetch(images[i]);
                const pageBlob = await pageRes.blob();
                const pageExt = pageBlob.type.split('/')[1] || 'png';
                const pageFilename = `page_${(i + 1).toString().padStart(3, '0')}.jpg`;

                const folder = zip.folder(`page_${(i + 1).toString().padStart(3, '0')}`);
                if (!folder) continue;

                folder.file(pageFilename, pageBlob);

                // 2. Call segmentation API with includeImages=true
                const formData = new FormData();
                formData.append("file", pageBlob, pageFilename);
                formData.append("includeImages", "true");

                const segRes = await fetch("/api/segment", {
                    method: "POST",
                    body: formData
                });

                if (!segRes.ok) throw new Error(`Erreur segmentation page ${i + 1}`);

                const segData = await segRes.json();
                const linesFolder = folder.folder("lines");

                const manifest = {
                    page: pageFilename,
                    transcription: transcriptions[i] || "",
                    lines: [] as any[]
                };

                if (segData.lines && linesFolder) {
                    for (let j = 0; j < segData.lines.length; j++) {
                        const line = segData.lines[j];
                        if (line.image) {
                            const lineFilename = `line_${(j + 1).toString().padStart(3, '0')}.png`;
                            const base64Data = line.image.split(',')[1];
                            linesFolder.file(lineFilename, base64Data, { base64: true });

                            manifest.lines.push({
                                index: j + 1,
                                image: `lines/${lineFilename}`,
                                bbox: line.bbox,
                                baseline: line.baseline,
                                boundary: line.boundary
                            });
                        }
                    }
                }

                folder.file("manifest.json", JSON.stringify(manifest, null, 2));
            }

            setProgress(100);
            const content = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(content);
            const a = document.createElement("a");
            a.href = url;
            a.download = "export_transcription_plateforme.zip";
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Exportation terminée");
        } catch (error: any) {
            console.error(error);
            toast.error(`Échec de l'exportation: ${error.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Card className="w-full h-[calc(100vh-2rem)] flex flex-col bg-[#FDFCF8]">
            <CardHeader className="flex flex-row items-center justify-between py-3 border-b bg-white/50 backdrop-blur-sm z-30">
                <CardTitle className="text-xl font-serif font-bold tracking-wide text-stone-800">
                    Atelier de Transcription en Masse
                </CardTitle>
                <div className="flex items-center gap-4">
                    {/* Font Family Switcher */}
                    <div className="flex bg-stone-100 rounded-md p-1 gap-1">
                        <button
                            onClick={() => setFontFamily("font-scheherazade")}
                            className={`px-3 py-1 text-xs rounded-sm transition-all ${fontFamily === "font-scheherazade" ? "bg-white shadow text-stone-800" : "text-stone-400 hover:text-stone-600"}`}
                        >
                            Scheherazade
                        </button>
                        <button
                            onClick={() => setFontFamily("font-rabat")}
                            className={`px-3 py-1 text-xs rounded-sm transition-all ${fontFamily === "font-rabat" ? "bg-white shadow text-stone-800" : "text-stone-400 hover:text-stone-600"}`}
                        >
                            Rabat
                        </button>
                    </div>

                    <Separator orientation="vertical" className="h-6" />

                    <div className="relative">
                        <input
                            type="file"
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={handleFileUpload}
                            accept="application/pdf,image/*"
                            disabled={isProcessing}
                        />
                        <Button variant="ghost" size="sm" className="gap-2 text-stone-600">
                            <Upload className="w-4 h-4" />
                            Ouvrir PDF
                        </Button>
                    </div>

                    {images.length > 0 && (
                        <>
                            <Button
                                variant="default"
                                size="sm"
                                onClick={runBulkOCR}
                                disabled={isProcessing}
                                className="gap-2 bg-emerald-700 hover:bg-emerald-800 shadow-md"
                            >
                                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
                                Transcrire ({images.length} pages)
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleExport}
                                disabled={isProcessing || Object.keys(transcriptions).length === 0}
                                className="gap-2 border-stone-200"
                            >
                                <FileDown className="w-4 h-4" />
                                .txt
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleTranscriptionExport}
                                disabled={isProcessing}
                                className="gap-2 border-stone-200 bg-amber-50 hover:bg-amber-100 text-amber-900"
                            >
                                <FileDown className="w-4 h-4" />
                                Export Plateforme (.zip)
                            </Button>
                        </>
                    )}
                </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-hidden p-0 flex">
                {images.length > 0 ? (
                    <div className="flex-1 flex overflow-hidden">
                        {/* Preview Panel */}
                        <div className="flex-1 relative bg-stone-100/50 flex flex-col border-r border-stone-200">
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-white/90 backdrop-blur shadow-sm border border-stone-200 px-4 py-1.5 rounded-full ring-1 ring-black/5">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                    disabled={currentPage === 0}
                                    className="h-8 w-8 hover:bg-stone-100"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </Button>
                                <span className="text-sm font-serif italic text-stone-600">Folio {currentPage + 1} / {images.length}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setCurrentPage(p => Math.min(images.length - 1, p + 1))}
                                    disabled={currentPage === images.length - 1}
                                    className="h-8 w-8 hover:bg-stone-100"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </Button>
                            </div>
                            <div className="flex-1 p-12 flex items-center justify-center overflow-auto bg-[url('https://www.transparenttextures.com/patterns/pinstriped-suit.png')]">
                                <div className="relative shadow-2xl rounded-sm overflow-hidden bg-white ring-8 ring-white/50">
                                    <img
                                        src={images[currentPage]}
                                        alt={`Page ${currentPage + 1}`}
                                        className="max-w-full max-h-[80vh] object-contain"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Transcription Panel */}
                        <div className="w-1/2 flex flex-col bg-[#FDFCF8] relative">
                            {/* Decorative Spine Shadow */}
                            <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-stone-400/10 to-transparent pointer-events-none z-20"></div>

                            <div className="p-6 border-b bg-white/50 backdrop-blur-sm flex flex-col gap-4 z-30">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Progression globale</span>
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{Object.keys(transcriptions).length} / {images.length} pages</span>
                                </div>
                                <Progress value={progress} className="h-1 bg-stone-100" />

                                <div className="flex items-center justify-between pt-2">
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-stone-400 uppercase tracking-wider">Taille</span>
                                            <Button variant="outline" size="icon" onClick={() => setFontSize(s => Math.max(12, s - 2))} className="h-7 w-7 rounded-full bg-white border-stone-200">
                                                <span className="text-xs">-</span>
                                            </Button>
                                            <span className="w-8 text-center text-xs font-medium tabular-nums">{fontSize}</span>
                                            <Button variant="outline" size="icon" onClick={() => setFontSize(s => Math.min(48, s + 2))} className="h-7 w-7 rounded-full bg-white border-stone-200">
                                                <span className="text-xs">+</span>
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-stone-400 uppercase tracking-wider">Espacement</span>
                                            <Button variant="outline" size="icon" onClick={() => setLineSpacing(s => Math.max(1, s - 0.25))} className="h-7 w-7 rounded-full bg-white border-stone-200">
                                                <span className="text-xs">-</span>
                                            </Button>
                                            <span className="w-8 text-center text-xs font-medium tabular-nums">{lineSpacing}</span>
                                            <Button variant="outline" size="icon" onClick={() => setLineSpacing(s => Math.min(4, s + 0.25))} className="h-7 w-7 rounded-full bg-white border-stone-200">
                                                <span className="text-xs">+</span>
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <ScrollArea className="flex-1 p-8">
                                <div className="max-w-3xl mx-auto space-y-12 pb-40" dir="rtl">
                                    {images.map((_, i) => (
                                        <div
                                            key={i}
                                            onClick={() => setCurrentPage(i)}
                                            className={`relative transition-all duration-300 rounded-xl p-6 cursor-pointer ${i === currentPage ? 'bg-emerald-50/40 ring-1 ring-emerald-100' : 'hover:bg-stone-50/50'}`}
                                        >
                                            <div className="flex justify-between items-center mb-6" dir="ltr">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest px-2 py-0.5 bg-stone-100 rounded">Folio {i + 1}</span>
                                                    {transcriptions[i] ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Loader2 className="w-3.5 h-3.5 text-stone-200 animate-spin" />}
                                                </div>
                                                {i === currentPage && <span className="text-[10px] text-emerald-600 font-bold uppercase">Édition active</span>}
                                            </div>

                                            <textarea
                                                className={`w-full bg-transparent border-none resize-none focus:ring-0 p-0 text-stone-800 ${fontFamily} leading-relaxed outline-none overflow-hidden transition-all`}
                                                style={{
                                                    fontSize: `${fontSize}px`,
                                                    lineHeight: lineSpacing,
                                                    minHeight: '4em'
                                                }}
                                                placeholder={isProcessing && !transcriptions[i] && i >= Object.keys(transcriptions).length ? "En attente de traitement..." : "Transcription..."}
                                                value={transcriptions[i] || ""}
                                                onChange={(e) => {
                                                    const newText = e.target.value;
                                                    setTranscriptions(prev => ({ ...prev, [i]: newText }));
                                                    e.target.style.height = 'auto';
                                                    e.target.style.height = e.target.scrollHeight + 'px';
                                                }}
                                                onFocus={(e) => {
                                                    e.target.style.height = 'auto';
                                                    e.target.style.height = e.target.scrollHeight + 'px';
                                                }}
                                                ref={(el) => {
                                                    if (el) {
                                                        el.style.height = 'auto';
                                                        el.style.height = el.scrollHeight + 'px';
                                                    }
                                                }}
                                            />

                                            {i < images.length - 1 && (
                                                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2">
                                                    <Separator className="w-8 bg-stone-200" />
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    <div className="mt-20 text-center">
                                        <Separator className="w-12 mx-auto bg-stone-300 mb-4" />
                                        <p className="text-stone-300 text-sm font-serif italic">Fin du document</p>
                                    </div>
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-stone-500 bg-stone-50/30">
                        <div className="p-10 rounded-full bg-white shadow-xl ring-1 ring-black/5 mb-8">
                            <Languages className="w-20 h-20 opacity-10" />
                        </div>
                        <h3 className="text-2xl font-serif italic mb-4 text-stone-800">Prêt pour la transcription globale</h3>
                        <p className="max-w-md text-stone-400 leading-relaxed">
                            Uploadez un manuscrit au format PDF pour lancer un traitement automatique sur l'ensemble des pages.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
