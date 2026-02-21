'use client';

import React, { useState, useRef, useEffect } from 'react';

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, FileText, Globe, Sparkles, Link as LinkIcon } from 'lucide-react';
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";

// Dynamically import ReactPlayer removed to avoid hydration issues
// const ReactPlayer = dynamic(() => import('react-player'), { ssr: false }) as any;

interface Segment {
    start: number;
    end: number;
    text: string;
}

export default function VideoPage() {
    const [videoUrl, setVideoUrl] = useState<string>('');
    const [inputUrl, setInputUrl] = useState<string>('');
    const [videoId, setVideoId] = useState<string>(''); // For translation API
    const [isReady, setIsReady] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);

    // Transcription Data
    const [transcriptionText, setTranscriptionText] = useState("");
    const [segments, setSegments] = useState<Segment[]>([]);

    // Analysis Data
    const [translationText, setTranslationText] = useState("");
    const [summaryText, setSummaryText] = useState("");

    // UI State
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [captionsUrl, setCaptionsUrl] = useState<string>("");
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    const playerRef = useRef<HTMLVideoElement>(null);
    const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);

    const [downloadProgress, setDownloadProgress] = useState<{ percent: string, eta: string, speed: string } | null>(null);

    // Auto-scroll to active segment
    useEffect(() => {
        if (!isPlaying) return;
        const activeIndex = segments.findIndex(s => currentTime >= s.start && currentTime <= s.end);
        if (activeIndex !== -1 && segmentRefs.current[activeIndex]) {
            segmentRefs.current[activeIndex]?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }, [currentTime, isPlaying, segments]);

    const formatTime = (seconds: number) => {
        if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) return "00:00";
        try {
            return new Date(seconds * 1000).toISOString().substr(14, 5);
        } catch (e) {
            return "00:00";
        }
    };

    const handleSeekTo = (time: number) => {
        if (playerRef.current) {
            try {
                // Native HTML5 Video Element seeking
                playerRef.current.currentTime = time;
                playerRef.current.play(); // Auto-play
                setIsPlaying(true);
            } catch (err) {
                console.error("Seek error:", err);
            }
        } else {
            console.warn("Player ref not ready");
        }
    };

    const handleTranslate = async () => {
        console.log("handleTranslate called. VideoID:", videoId, "Segments:", segments.length);
        if (!videoId || !segments.length) {
            console.error("Cannot translate: Missing videoId or segments");
            toast.error("Données manquantes pour la traduction (ID vidéo ou segments).");
            return;
        }
        setIsAnalyzing(true);
        setStatusMessage("Traduction en cours (DeepSeek)...");

        try {
            const response = await fetch('/api/video/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_id: videoId, segments })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            // Update with translated content
            setSegments(data.segments); // Update interactive transcript
            setTranscriptionText(data.segments.map((s: any) => s.text).join(' ')); // Update plain text view if needed

            if (data.srt_path) {
                console.log("Setting French captions:", data.srt_path);
                setTranslationText("Traduction chargée dans le lecteur et la transcription.");
                setCaptionsUrl(`/api/video/stream?file=${encodeURIComponent(data.srt_path)}`);
                toast.success("Traduction générée avec succès !");
            }

        } catch (error: any) {
            console.error("Translation failed:", error);
            toast.error("Erreur de traduction via DeepSeek");
        } finally {
            setIsAnalyzing(false);
            setStatusMessage("");
        }
    };

    const handleAnalyze = async (type: 'translation' | 'summary') => {
        if (!transcriptionText) return;
        setIsAnalyzing(true);
        setStatusMessage(type === 'translation' ? "Traduction en cours..." : "Génération du résumé...");

        try {
            const response = await fetch('/api/video/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: transcriptionText, type })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);

            if (type === 'translation') setTranslationText(data.result);
            if (type === 'summary') setSummaryText(data.result);
            setStatusMessage("");
        } catch (error: any) {
            console.error("Analysis failed:", error);
            setStatusMessage("Erreur lors de l'analyse.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleTranscribe = async () => {
        // Redundant if handleLoadVideo is used, but kept for standalone generation if needed
        if (!videoUrl) return;
        setIsTranscribing(true);
        setStatusMessage("Initializing...");
        setTranscriptionText("");
        setSegments([]);
        // ... reuse fetch logic from handleLoadVideo if needed ...
        // For now, handleLoadVideo does everything.
    };

    const convertToPublicPath = (absolutePath: string) => {
        // Convert J:\UnivHm_NextJS\bnf-manuscripts-poc\public\transcriptions\file.mp4 
        // to /transcriptions/file.mp4
        if (!absolutePath) return "";
        const lowerPath = absolutePath.toLowerCase();
        const publicIndex = lowerPath.indexOf('public');
        if (publicIndex !== -1) {
            return absolutePath.substring(publicIndex + 6).replace(/\\/g, '/');
        }
        return absolutePath; // Fallback to original if not in public
    };

    const handleLoadVideo = async () => {
        if (!inputUrl) return;
        setVideoUrl(inputUrl);

        setIsReady(true);
        setIsTranscribing(true);
        setDownloadProgress(null);
        setStatusMessage("Démarrage du téléchargement...");
        setTranscriptionText("");
        setSegments([]);
        setCaptionsUrl("");
        setVideoId("");

        try {
            console.log("Starting transcription request for:", inputUrl);
            const response = await fetch('/api/video/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: inputUrl })
            });

            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedChunk = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log("Stream reader done.");
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                accumulatedChunk += chunk;

                const lines = accumulatedChunk.split('\n');
                accumulatedChunk = lines.pop() || "";

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;

                    // Skip known non-JSON log lines to keep console clean
                    if (trimmedLine.startsWith('INFO:') || trimmedLine.startsWith('[') || trimmedLine.startsWith('WARNING:')) {
                        console.log("Bridge Log:", trimmedLine);
                        continue;
                    }

                    try {
                        const data = JSON.parse(trimmedLine);

                        if (data.status === 'progress') {
                            setStatusMessage(data.message);
                        } else if (data.status === 'downloading') {
                            setDownloadProgress(data);
                        } else if (data.status === 'success') {
                            console.log("Transcription success:", data);
                            setStatusMessage("Terminé !");
                            toast.success("Vidéo prête !");

                            if (data.transcription) setTranscriptionText(data.transcription);
                            if (data.segments) setSegments(data.segments);

                            if (data.video_path) {
                                console.log("Setting video source (Stream API):", data.video_path);
                                setVideoUrl(`/api/video/stream?file=${encodeURIComponent(data.video_path)}`);
                            }
                            if (data.srt_path) {
                                console.log("Setting captions source (Stream API):", data.srt_path);
                                setCaptionsUrl(`/api/video/stream?file=${encodeURIComponent(data.srt_path)}`);
                            }
                            if (data.video_id) {
                                console.log("Setting Video ID:", data.video_id);
                                setVideoId(data.video_id);
                            } else {
                                console.warn("No video_id returned from bridge!");
                            }
                        } else if (data.status === 'error') {
                            setStatusMessage(`Erreur: ${data.error}`);
                            toast.error(data.error || "Une erreur est survenue");
                            setDownloadProgress(null);
                        }
                    } catch (e) {
                        // Only warn if it really looks like it should have been JSON
                        if (trimmedLine.startsWith('{')) {
                            console.warn("Failed to parse JSON line:", trimmedLine);
                        } else {
                            console.log("Raw output:", trimmedLine);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Workflow failed", error);
            setStatusMessage("Erreur de communication.");
        } finally {
            setIsTranscribing(false);
            setDownloadProgress(null);
        }
    };

    return (
        <div className="h-screen flex flex-col bg-stone-50 text-stone-900 font-sans">
            <PageHeader
                title="Atelier Vidéo"
                leftContent={
                    <div className="flex items-center gap-2">
                        <div className="relative w-96">
                            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
                            <Input
                                placeholder="Collez une URL YouTube ou Facebook..."
                                className="pl-9 h-8 bg-white text-sm"
                                value={inputUrl}
                                onChange={(e) => setInputUrl(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
                            />
                        </div>
                        <Button size="sm" onClick={handleLoadVideo} disabled={!inputUrl || isTranscribing} className="h-8">
                            {isTranscribing ? <Sparkles className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-2" />}
                            Charger
                        </Button>
                    </div>
                }
            />

            {/* Main Content - Split View */}
            <div className="flex-1 flex overflow-hidden">

                {/* LEFT: Video Player */}
                <div className="w-1/2 flex flex-col border-r border-stone-200 bg-black/5 relative justify-center bg-black">
                    {/* Video wrapper to center properly */}
                    <div className="relative w-full h-full flex items-center justify-center">
                        {videoUrl ? (
                            <video
                                ref={playerRef}
                                src={videoUrl}
                                className="w-full h-full object-contain"
                                controls
                                autoPlay
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                                onError={(e) => {
                                    console.error("Video Error:", e);
                                    toast.error("Erreur de lecture vidéo native");
                                }}
                            >
                                {captionsUrl && (
                                    <track
                                        kind="subtitles"
                                        src={captionsUrl}
                                        srcLang="ar"
                                        label="Arabic"
                                        default
                                    />
                                )}
                                Votre navigateur ne supporte pas la lecture vidéo.
                            </video>
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-stone-500">
                                <div className="text-center">
                                    <Play className="w-16 h-16 mx-auto mb-4 opacity-20" />
                                    <p>Entrez une URL pour commencer</p>
                                </div>
                            </div>
                        )}

                        {downloadProgress && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20 text-white flex-col">
                                <div className="text-4xl font-bold mb-2">{downloadProgress.percent}%</div>
                                <div className="text-sm text-stone-300">ETA: {downloadProgress.eta} • {downloadProgress.speed}</div>
                                <div className="mt-4 text-emerald-400 animate-pulse">Téléchargement en cours...</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Analysis Workspace */}
                <div className="w-1/2 flex flex-col bg-stone-50">
                    <Tabs defaultValue="transcript" className="flex-1 flex flex-col">
                        <div className="px-4 pt-4 border-b border-stone-200 bg-white shadow-sm">
                            <TabsList className="grid w-full grid-cols-3 mb-4">
                                <TabsTrigger value="transcript" className="gap-2"><FileText className="w-4 h-4" /> Transcription</TabsTrigger>
                                <TabsTrigger value="translation" className="gap-2"><Globe className="w-4 h-4" /> Traduction</TabsTrigger>
                                <TabsTrigger value="summary" className="gap-2"><Sparkles className="w-4 h-4" /> Académie</TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent value="transcript" className="flex-1 p-0 m-0 relative">
                            {segments.length > 0 ? (
                                <div className="absolute inset-0 overflow-auto p-6 space-y-4">
                                    {segments.map((segment, index) => {
                                        const isActive = currentTime >= segment.start && currentTime <= segment.end;
                                        return (
                                            <div
                                                key={index}
                                                ref={el => {
                                                    // This callback ref pattern is tricky with TS types, 
                                                    // but functional for this array assignment
                                                    if (el) segmentRefs.current[index] = el;
                                                }}
                                                onClick={() => handleSeekTo(segment.start)}
                                                className={`
                                                    p-3 rounded-lg cursor-pointer transition-all duration-200 border
                                                    ${isActive
                                                        ? 'bg-emerald-50 border-emerald-200 shadow-sm scale-[1.01]'
                                                        : 'hover:bg-white border-transparent hover:border-stone-200 hover:shadow-sm text-stone-600'
                                                    }
                                                `}
                                            >
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className={`text-xs font-mono ${isActive ? 'text-emerald-600 font-bold' : 'text-stone-400'}`}>
                                                        {formatTime(segment.start)}
                                                    </span>
                                                </div>
                                                <p className={`text-lg font-serif leading-relaxed ${isActive ? 'text-stone-900' : ''}`} dir="auto">
                                                    {segment.text}
                                                </p>
                                            </div>
                                        );
                                    })}
                                    <div className="h-20" /> {/* Bottom spacer */}
                                </div>
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-stone-400">
                                    <div className="text-center">
                                        {isTranscribing ? (
                                            <>
                                                <Sparkles className="w-8 h-8 mx-auto mb-4 animate-pulse text-emerald-500" />
                                                <p className={`mb-2 font-medium ${statusMessage.startsWith('Erreur') ? 'text-red-500' : 'text-stone-600'}`}>{statusMessage}</p>
                                                <p className="text-xs text-stone-400">Cela peut prendre quelques minutes...</p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="mb-4">Aucune transcription disponible.</p>
                                                {transcriptionText && !segments.length && (
                                                    <div className="p-6 text-left whitespace-pre-wrap font-serif text-lg">
                                                        {transcriptionText}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="translation" className="flex-1 p-0 m-0 relative">
                            <div className="absolute inset-0 flex items-center justify-center text-stone-400">
                                <div className="text-center">
                                    <p className="mb-4">{transcriptionText ? (translationText ? "Traduction effectuée." : "Traduire les sous-titres et la transcription ?") : "Veuillez d'abord transcrire la vidéo."}</p>
                                    <Button
                                        variant="outline"
                                        disabled={!transcriptionText || isAnalyzing}
                                        onClick={handleTranslate}
                                    >
                                        {isAnalyzing ? <Sparkles className="w-4 h-4 mr-2 animate-spin" /> : <Globe className="w-4 h-4 mr-2" />}
                                        Traduire en Français (DeepSeek)
                                    </Button>
                                    {translationText && (
                                        <p className="mt-2 text-sm text-emerald-600">{translationText}</p>
                                    )}
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="summary" className="flex-1 p-0 m-0 relative">
                            {summaryText ? (
                                <div className="absolute inset-0 p-6 overflow-auto prose prose-stone max-w-none">
                                    <div dangerouslySetInnerHTML={{ __html: summaryText.replace(/\n/g, '<br/>') }} />
                                </div>
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-stone-400">
                                    <div className="text-center">
                                        <p className="mb-4">{transcriptionText ? "Analyse académique prête." : "Veuillez d'abord transcrire la vidéo."}</p>
                                        <Button
                                            variant="outline"
                                            disabled={!transcriptionText || isAnalyzing}
                                            onClick={() => handleAnalyze('summary')}
                                        >
                                            {isAnalyzing ? <Sparkles className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                                            Générer le Résumé
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div >
    );
}
