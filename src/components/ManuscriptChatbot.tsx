"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Volume2, CheckCircle, ChevronLeft, ChevronRight, X, Send, Maximize2, Minimize2 } from "lucide-react";
// @ts-ignore
import { useChat } from "@ai-sdk/react";
// import { type UIMessage as Message } from "@ai-sdk/react"; // Attempt explicit type if needed, or just let inference work for now
// Actually, let's use 'any' in the map to be safe if strict type fails, or alias UIMessage
import { type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

type Message = UIMessage;

interface ManuscriptChatbotProps {
    className?: string;
    transcriptionText?: string;
}

const ManuscriptChatbot: React.FC<ManuscriptChatbotProps> = ({ className, transcriptionText }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [width, setWidth] = useState(320); // Default width 320px
    const [isExpanded, setIsExpanded] = useState(false);

    // Vercel AI SDK useChat hook
    // Vercel AI SDK useChat hook (manual handling for @ai-sdk/react structure)
    const { messages, status, sendMessage, stop } = useChat({
        transport: new DefaultChatTransport({
            api: '/api/chat',
            body: { text: transcriptionText }, // Pass current text context
        }),
        messages: [
            { id: 'welcome', role: 'assistant', parts: [{ type: 'text', text: "Bonjour ! Je suis votre assistant. Comment puis-je vous aider avec ce manuscrit ?" }] }
        ]
    });

    // Manual state management since useChat in this version doesn't provide these
    const [input, setInput] = useState('');
    const isLoading = status === 'submitted' || status === 'streaming';

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!input.trim()) return;

        const text = input;
        setInput(''); // Clear input immediately
        await sendMessage({ text });
    };

    const scrollViewportRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (scrollViewportRef.current) {
            scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight;
        }
    }, [messages, isLoading]);

    const toggleOpen = () => setIsOpen(!isOpen);

    const toggleExpand = () => {
        if (isExpanded) {
            setWidth(320);
        } else {
            setWidth(600);
        }
        setIsExpanded(!isExpanded);
    };

    const handleAction = async (action: 'vocalize' | 'correct') => {
        if (!transcriptionText) return;

        const prompt = action === 'vocalize'
            ? "Peux-tu vocaliser (ajouter le Tashkeel) au texte suivant du manuscrit ?"
            : "Peux-tu corriger les fautes d'orthographe et de grammaire du texte suivant ?";

        await sendMessage({
            text: `${prompt}\n\n"${transcriptionText}"`
        });
    };

    return (
        <div
            className={`fixed left-0 top-20 bottom-0 z-40 flex transition-all duration-300 ${className} ${isOpen ? 'shadow-2xl' : ''}`}
            style={{ width: isOpen ? `${width}px` : '3rem' }}
        >
            {/* Toggle Button / Bar */}
            <div
                className="w-12 h-full bg-stone-900 flex flex-col items-center py-4 gap-4 cursor-pointer hover:bg-stone-800 transition-colors shadow-xl z-50 absolute left-0 top-0 bottom-0"
                onClick={toggleOpen}
            >
                <div className="p-2 rounded-full bg-stone-800 text-stone-200">
                    <MessageSquare className="w-5 h-5" />
                </div>
                {isOpen ? <ChevronLeft className="text-stone-500" /> : <ChevronRight className="text-stone-500" />}

                <div className="flex-1" />
                <span className="text-stone-500 text-[10px] uppercase font-bold tracking-widest whitespace-nowrap mb-8" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                    Assistant IA
                </span>
            </div>

            {/* Chat Content Panel */}
            {isOpen && (
                <div className="flex-1 bg-stone-50 border-r border-stone-200 flex flex-col h-full animate-in slide-in-from-left duration-300 ml-12 w-full">
                    {/* Header */}
                    <div className="p-4 border-b border-stone-200 bg-white flex justify-between items-center">
                        <h3 className="font-serif font-bold text-stone-800">Assistant Manuscrit</h3>
                        <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={toggleExpand} className="h-6 w-6 text-stone-400 hover:text-stone-700">
                                {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="h-6 w-6 text-stone-400 hover:text-red-500">
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="p-4 grid grid-cols-2 gap-2 bg-stone-100/50">
                        <Button variant="outline" size="sm" onClick={() => handleAction('vocalize')} disabled={isLoading || !transcriptionText} className="text-xs bg-white hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-colors">
                            <Volume2 className="w-3 h-3 mr-2" />
                            Vocaliser
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleAction('correct')} disabled={isLoading || !transcriptionText} className="text-xs bg-white hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors">
                            <CheckCircle className="w-3 h-3 mr-2" />
                            Corriger
                        </Button>
                    </div>

                    {/* Messages Area */}
                    <ScrollArea className="flex-1 p-4" viewportRef={scrollViewportRef}>
                        <div className="space-y-4 pb-4">
                            {messages.map((m: any) => (
                                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-stone-800 text-white' : 'bg-white border border-stone-200 text-stone-700 shadow-sm'}`}>
                                        {m.parts ? m.parts.map((part: any, i: number) => {
                                            if (part.type === 'text') return part.text;
                                            return null;
                                        }) : m.content}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="flex justify-start">
                                    <div className="bg-white border border-stone-200 rounded-lg p-3 shadow-sm">
                                        <div className="flex gap-1">
                                            <span className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" />
                                            <span className="w-2 h-2 bg-stone-400 rounded-full animate-bounce delay-75" />
                                            <span className="w-2 h-2 bg-stone-400 rounded-full animate-bounce delay-150" />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </ScrollArea>

                    {/* Input Area */}
                    <div className="p-3 border-t border-stone-200 bg-white">
                        <form onSubmit={handleSubmit} className="relative">
                            <Input
                                placeholder="Posez une question..."
                                value={input}
                                onChange={handleInputChange}
                                className="pr-10 focus-visible:ring-stone-400"
                            />
                            <Button
                                type="submit"
                                size="icon"
                                variant="ghost"
                                disabled={isLoading || !input.trim()}
                                className="absolute right-1 top-1 h-7 w-7 text-stone-400 hover:text-stone-800"
                            >
                                <Send className="w-4 h-4" />
                            </Button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManuscriptChatbot;
