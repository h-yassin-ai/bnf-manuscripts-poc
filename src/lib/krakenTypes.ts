export type Point = [number, number];

export interface KrakenLine {
    id: string;
    baseline: Point[] | null;
    boundary: Point[] | null;
    text: string | null;
}

export interface KrakenSegmentation {
    type: string;
    text_direction: string;
    imagename: string;
    lines: KrakenLine[];
}

export interface OCRMapping {
    [lineId: string]: string;
}
