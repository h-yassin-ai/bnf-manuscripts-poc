"use client";

import { useState } from "react";
import { UploadZone } from "@/components/upload-zone";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Search, Send, ZoomIn, ZoomOut, RotateCcw, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";

export function WorkspaceClient() {
    const [file, setFile] = useState<File | null>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [transcription, setTranscription] = useState("");
    const [scale, setScale] = useState(1);
    const [searchQuery, setSearchQuery] = useState("");

    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
    const [currentMessage, setCurrentMessage] = useState("");
    const [isChatting, setIsChatting] = useState(false);

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        setImageUrl(URL.createObjectURL(selectedFile));
        setIsProcessing(true);
        setTranscription("");
        setChatMessages([]);

        // Create FormData
        const formData = new FormData();
        formData.append("file", selectedFile);

        try {
            const response = await fetch("/api/ocr", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "OCR Failed");
            }

            const data = await response.json();
            setTranscription(data.text);
            toast.success("Transcription complete!");
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to transcribe image");
            setTranscription(`Error during transcription: ${error.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSendMessage = async () => {
        if (!currentMessage.trim()) return;

        const userMsg = currentMessage;
        setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setCurrentMessage("");
        setIsChatting(true);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg, context: transcription })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Chat failed");
            }

            const data = await response.json();
            setTranscription(prev => prev); // keep transcription
            setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to send message");
            setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
        } finally {
            setIsChatting(false);
        }
    };

    const handleZoomIn = () => setScale(s => Math.min(s + 0.2, 3));
    const handleZoomOut = () => setScale(s => Math.max(s - 0.2, 0.5));
    const handleResetZoom = () => setScale(1);

    if (!file) {
        return (
            <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto p-6">
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold tracking-tight mb-2">Upload Manuscript</h2>
                    <p className="text-muted-foreground">Select a page to begin digitization</p>
                </div>
                <div className="w-full">
                    <UploadZone onFileSelect={handleFileSelect} />
                </div>
            </div>
        );
    }

    return (
        <ResizablePanelGroup orientation="horizontal" className="h-[calc(100vh-4rem)] rounded-lg border shadow-sm mx-auto max-w-[1920px]">
            <ResizablePanel defaultSize={50} minSize={30} className="bg-zinc-100 dark:bg-zinc-900/50">
                <div className="h-full flex flex-col relative">
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-1 p-1 rounded-lg bg-background/90 backdrop-blur border shadow-sm">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut}><ZoomOut className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleResetZoom}><RotateCcw className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn}><ZoomIn className="h-4 w-4" /></Button>
                    </div>
                    <ScrollArea className="h-full w-full">
                        <div className="flex items-center justify-center min-h-full p-8 transition-transform duration-200 ease-out origin-center" style={{ transform: `scale(${scale})` }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={imageUrl || ""} alt="Manuscript" className="max-w-full rounded shadow-xl ring-1 ring-border" />
                        </div>
                    </ScrollArea>
                </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={30}>
                <div className="h-full flex flex-col bg-background">
                    <div className="flex items-center gap-2 p-3 border-b">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search transcription..."
                                className="pl-9 bg-muted/30 pr-20"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && transcription && (
                                <div className="absolute right-3 top-2.5 text-xs text-muted-foreground font-medium">
                                    {transcription.toLowerCase().split(searchQuery.toLowerCase()).length - 1} matches
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 flex flex-col">
                        {isProcessing ? (
                            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                                <p className="animate-pulse">Transcribing manuscript...</p>
                            </div>
                        ) : (
                            <div className="flex-1 relative">
                                {/* A simplified highlight overlay could go here, but for now just text */}
                                <Textarea
                                    className="h-full w-full resize-none font-mono text-base leading-relaxed bg-transparent border-0 focus-visible:ring-0 p-6 rounded-none"
                                    value={transcription}
                                    onChange={(e) => setTranscription(e.target.value)}
                                    placeholder="Transcription will appear here..."
                                />
                            </div>
                        )}
                    </div>
                    <div className="h-1/3 min-h-[200px] border-t flex flex-col bg-muted/5">
                        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/10">
                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                <MessageSquare className="h-4 w-4" />
                                Chat with Manuscript
                            </h3>
                        </div>
                        <ScrollArea className="flex-1 p-4">
                            <div className="space-y-4">
                                {chatMessages.map((msg, idx) => (
                                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${msg.role === 'user'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted border'
                                            }`}>
                                            {msg.content}
                                        </div>
                                    </div>
                                ))}
                                {isChatting && (
                                    <div className="flex justify-start">
                                        <div className="bg-muted border rounded-lg px-3 py-2 text-sm animate-pulse">
                                            Thinking...
                                        </div>
                                    </div>
                                )}
                                {chatMessages.length === 0 && !isChatting && (
                                    <div className="text-center text-muted-foreground text-sm py-8">
                                        Ask questions about the manuscript contents here.
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                        <div className="p-3 border-t bg-background">
                            <form
                                onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                                className="flex gap-2"
                            >
                                <Input
                                    value={currentMessage}
                                    onChange={(e) => setCurrentMessage(e.target.value)}
                                    placeholder="Type your question..."
                                    className="flex-1"
                                    disabled={isChatting || !transcription}
                                />
                                <Button type="submit" size="icon" disabled={isChatting || !transcription}>
                                    <Send className="h-4 w-4" />
                                </Button>
                            </form>
                        </div>
                    </div>
                </div>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}
