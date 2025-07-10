import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fromPath } from 'pdf2pic';
import { BoundingBox } from './types';

export class PDFProcessor {
  private pdfPath: string;
  private outputDir: string;
  private dpi: number; // DPI for color accuracy

  constructor(pdfPath: string, outputDir: string = 'output', dpi: number = 300) {
    this.pdfPath = pdfPath;
    this.outputDir = outputDir;
    this.dpi = dpi; // High DPI for maximum color accuracy and quality
    this.ensureOutputDirectoryExists();
  }

  private ensureOutputDirectoryExists(): void {
    if (!fs.existsSync(this.outputDir)) {
      // Create directory if it doesn't exist
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  private ensureOutputDirectory(): void {
    if (fs.existsSync(this.outputDir)) {
      // Clean existing directory for fresh run
      console.log('🧹 Cleaning output directory for fresh run...');
      const files = fs.readdirSync(this.outputDir);
      for (const file of files) {
        const filePath = path.join(this.outputDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      }
    } else {
      // Create directory if it doesn't exist
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Clean output directory selectively based on processing type
   */
  public cleanOutputDirectory(processReferences: boolean = true, processSwatches: boolean = true): void {
    if (fs.existsSync(this.outputDir)) {
      console.log('🧹 Cleaning output directory...');
      const files = fs.readdirSync(this.outputDir);
      
      for (const file of files) {
        const filePath = path.join(this.outputDir, file);
        if (fs.statSync(filePath).isFile()) {
          let shouldDelete = false;
          
          // Reference color files
          if (file.startsWith('debug_color_box_') || file.startsWith('debug_red_anchor_') || 
              file === 'reference_colors.json' || file === 'reference_colors_raw.json') {
            shouldDelete = processReferences;
          }
          
          // Swatch files
          else if (file.startsWith('swatch_') || file === 'swatches.json') {
            shouldDelete = processSwatches;
          }
          
          // Color matching files (should be cleaned when either process is run)
          else if (file === 'color_matches.json' || file.startsWith('matched_')) {
            shouldDelete = processReferences || processSwatches;
          }
          
          // Page files and other general files - clean when processing references
          else if (file.startsWith('page.') || file.startsWith('debug_') || file.startsWith('temp_')) {
            shouldDelete = processReferences;
          }
          
          if (shouldDelete) {
            console.log(`   Removing: ${file}`);
            fs.unlinkSync(filePath);
          } else {
            console.log(`   Keeping: ${file}`);
          }
        }
      }
    } else {
      // Create directory if it doesn't exist
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Get PDF dimensions first to calculate correct aspect ratio
   */
  private async getPDFDimensions(): Promise<{ width: number; height: number }> {
    try {
      // First, do a quick conversion to get the actual dimensions
      const tempConvert = fromPath(this.pdfPath, {
        density: 72, // Low DPI for quick dimension check
        saveFilename: "temp_dimension_check",
        savePath: this.outputDir,
        format: "png",
        width: 600, // Small size for quick processing
      });
      
      const tempResults = await tempConvert(1, { responseType: "buffer" });
      
      if (tempResults && tempResults.buffer) {
        const tempImagePath = path.join(this.outputDir, 'temp_dimension_check.1.png');
        const buffer = tempResults.buffer as Buffer;
        fs.writeFileSync(tempImagePath, buffer);
        
        // Get dimensions from the temporary image
        const tempDimensions = await this.getImageDimensions(tempImagePath);
        
        // Clean up temp file
        fs.unlinkSync(tempImagePath);
        
        // Calculate the aspect ratio from the small image
        const aspectRatio = tempDimensions.width / tempDimensions.height;
        
        // Return dimensions for a target width of 2400px
        return {
          width: 2400,
          height: Math.round(2400 / aspectRatio)
        };
      }
      
      // Fallback to default aspect ratio if temp conversion fails
      return { width: 2400, height: 1800 };
    } catch (error) {
      console.warn('Could not determine PDF dimensions, using default aspect ratio');
      return { width: 2400, height: 1800 };
    }
  }

  /**
   * Convert PDF pages to high-quality images with preserved aspect ratio
   */
  async convertPDFToImages(): Promise<string[]> {
    console.log(`🔧 Getting PDF dimensions to calculate correct aspect ratio...`);
    
    // Get the correct dimensions first
    const targetDimensions = await this.getPDFDimensions();
    
    console.log(`🔧 Converting PDF with DPI: ${this.dpi} and dimensions: ${targetDimensions.width}x${targetDimensions.height} (correct aspect ratio)`);
    
    const convert = fromPath(this.pdfPath, {
      density: this.dpi,
      saveFilename: "page",
      savePath: this.outputDir,
      format: "png",
      width: targetDimensions.width,
      height: targetDimensions.height, // Explicitly set height to maintain aspect ratio
    });

    try {
      const results = await convert.bulk(-1, { responseType: "buffer" });
      const imagePaths: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const imagePath = path.join(this.outputDir, `page.${i + 1}.png`);
        
        // Save the buffer to disk
        if (results[i] && results[i].buffer) {
          const buffer = results[i].buffer as Buffer;
          fs.writeFileSync(imagePath, buffer);
          
          // Log the actual dimensions to verify aspect ratio preservation
          const dimensions = await this.getImageDimensions(imagePath);
          console.log(`✓ Page ${i + 1} dimensions: ${dimensions.width}x${dimensions.height} (aspect ratio: ${(dimensions.width / dimensions.height).toFixed(2)})`);
          
          imagePaths.push(imagePath);
        }
      }

      console.log(`✓ Converted ${results.length} pages to images`);
      console.log(`✓ Saved images: ${imagePaths.join(', ')}`);
      
      return imagePaths;
    } catch (error) {
      console.error('Error converting PDF to images:', error);
      throw error;
    }
  }

  /**
   * Load and preprocess an image for analysis
   */
  async loadAndPreprocessImage(imagePath: string): Promise<sharp.Sharp> {
    const image = sharp(imagePath);
    
    // Get image metadata
    const metadata = await image.metadata();
    console.log(`Image dimensions: ${metadata.width}x${metadata.height}`);
    
    return image;
  }

  /**
   * Extract a region from an image based on bounding box
   */
  async extractRegion(imagePath: string, boundingBox: BoundingBox): Promise<Buffer> {
    const image = sharp(imagePath);
    
    const extracted = await image
      .extract({
        left: Math.round(boundingBox.x),
        top: Math.round(boundingBox.y),
        width: Math.round(boundingBox.width),
        height: Math.round(boundingBox.height)
      })
      .png()
      .toBuffer();
    
    return extracted;
  }

  /**
   * Get pixel color at specific coordinates
   */
  async getPixelColor(imagePath: string, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
    const image = sharp(imagePath);
    
    // Extract 1x1 pixel at specified coordinates
    const pixel = await image
      .extract({
        left: Math.round(x),
        top: Math.round(y),
        width: 1,
        height: 1
      })
      .raw()
      .toBuffer();
    
    return {
      r: pixel[0],
      g: pixel[1],
      b: pixel[2]
    };
  }

  /**
   * Save debug image with annotations
   */
  async saveDebugImage(imagePath: string, outputName: string, annotations: any[] = []): Promise<string> {
    const outputPath = path.join(this.outputDir, `debug_${outputName}.png`);
    await sharp(imagePath).png().toFile(outputPath);
    console.log(`Debug image saved: ${outputPath}`);
    return outputPath;
  }

  /**
   * Get the output directory path
   */
  get outputDirectory(): string {
    return this.outputDir;
  }

  /**
   * Get image dimensions
   */
  async getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
    const metadata = await sharp(imagePath).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0
    };
  }

  /**
   * Convert RGB to hex color
   */
  static rgbToHex(r: number, g: number, b: number): string {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
  }

  /**
   * Calculate color distance using Delta E method
   */
  static colorDistance(color1: { r: number; g: number; b: number }, color2: { r: number; g: number; b: number }): number {
    // Simple Euclidean distance in RGB space
    // For more accurate color matching, consider using Delta E in LAB color space
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
} 