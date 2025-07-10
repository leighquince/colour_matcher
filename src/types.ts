export interface ReferenceColor {
  colorCode: string;
  colorName: string;
  pantoneColor: string;
  rgb: { r: number; g: number; b: number };
  hex: string;
  boundingBox: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColorBox {
  rgb: { r: number; g: number; b: number };
  hex: string;
  boundingBox: BoundingBox;
  bottomRightPixel: { r: number; g: number; b: number };
}

export interface SwatchGroup {
  styleNumber: string;
  styleName: string;
  colors: ColorBox[];
  boundingBox: BoundingBox;
}

export interface ColorMatch {
  styleNumber: string;
  colorName: string;
  confidence: number;
  swatchColor: ColorBox;
  referenceColor: ReferenceColor;
}

export interface AnalysisResult {
  referenceColors: ReferenceColor[];
  swatchGroups: SwatchGroup[];
  matches: ColorMatch[];
}

export interface ProcessingOptions {
  pdfPath: string;
  outputPath: string;
  confidenceThreshold: number;
  colorTolerance: number;
  debugMode: boolean;
} 