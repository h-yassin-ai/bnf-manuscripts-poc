'use client';

import React from 'react';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { NotebookPen, Video, Scissors, Languages } from "lucide-react";

interface PageHeaderProps {
    title?: string;
    leftContent?: React.ReactNode;
    rightContent?: React.ReactNode;
}

export function PageHeader({ title = "Atelier de Transcription", leftContent, rightContent }: PageHeaderProps) {
    const pathname = usePathname();

    return (
        <header className="flex-shrink-0 bg-white/80 backdrop-blur-md border-b border-stone-200/60 py-3 px-6 shadow-sm z-50 flex items-center justify-between gap-4">

            {/* Left: Navigation & Page Specific Inputs */}
            <div className="flex items-center gap-4">
                {/* Navigation Switcher */}
                <div className="flex bg-stone-100 rounded-lg p-1 gap-1">
                    <Link href="/">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 text-xs ${pathname === '/' ? 'bg-white shadow text-stone-900' : 'text-stone-500 hover:text-stone-900'}`}
                        >
                            <NotebookPen className="w-3.5 h-3.5 mr-2" />
                            Projets
                        </Button>
                    </Link>
                    <Link href="/manuscrit">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 text-xs ${pathname?.startsWith('/manuscrit') ? 'bg-white shadow text-stone-900' : 'text-stone-500 hover:text-stone-900'}`}
                        >
                            <Scissors className="w-3.5 h-3.5 mr-2" />
                            Manuscrit
                        </Button>
                    </Link>
                    <Link href="/video">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 text-xs ${pathname?.startsWith('/video') ? 'bg-white shadow text-stone-900' : 'text-stone-500 hover:text-stone-900'}`}
                        >
                            <Video className="w-3.5 h-3.5 mr-2" />
                            Vidéo
                        </Button>
                    </Link>
                    <Link href="/ocr">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 text-xs ${pathname?.startsWith('/ocr') ? 'bg-white shadow text-stone-900' : 'text-stone-500 hover:text-stone-900'}`}
                        >
                            <Languages className="w-3.5 h-3.5 mr-2" />
                            Bulk OCR
                        </Button>
                    </Link>
                </div>

                {leftContent && (
                    <>
                        <Separator orientation="vertical" className="h-6" />
                        <div className="flex items-center gap-2">
                            {leftContent}
                        </div>
                    </>
                )}
            </div>

            {/* Center: Brand */}
            <div className="absolute left-1/2 transform -translate-x-1/2 text-center hidden md:block pointer-events-none">
                <h1 className="text-xl font-serif font-bold tracking-wide text-stone-800 opacity-90">
                    {title}
                </h1>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
                {rightContent}
            </div>
        </header>
    );
}
