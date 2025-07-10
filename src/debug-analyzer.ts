import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { PDFProcessor } from './pdf-processor';
import { BoundingBox } from './types';

export class DebugAnalyzer {
  private pdfProcessor: PDFProcessor;
  private outputDir: string;

  constructor(pdfProcessor: PDFProcessor, outputDir: string = 'output') {
    this.pdfProcessor = pdfProcessor;
    this.outputDir = outputDir;
  }

  /**
   * Analyze the PDF structure and create debug visualizations
   */
  async analyzePDF(imagePath: string): Promise<void> {
    console.log('🔍 Starting comprehensive PDF analysis...');
    
    const dimensions = await this.pdfProcessor.getImageDimensions(imagePath);
    console.log(`📐 Image dimensions: ${dimensions.width}x${dimensions.height}`);

    // Analyze different sections of the image
    await this.analyzeTopSection(imagePath, dimensions);
    await this.analyzeColorDistribution(imagePath, dimensions);
    await this.findRectangularRegions(imagePath, dimensions);
    await this.analyzeTextRegions(imagePath, dimensions);
  }

  /**
   * Analyze the top section where reference colors are expected
   */
  private async analyzeTopSection(imagePath: string, dimensions: { width: number; height: number }): Promise<void> {
    console.log('🎨 Analyzing top section for reference colors...');
    
    // Extract different portions of the top section
    const sections = [
      { name: 'top_5_percent', height: dimensions.height * 0.05 },
      { name: 'top_10_percent', height: dimensions.height * 0.10 },
      { name: 'top_15_percent', height: dimensions.height * 0.15 },
      { name: 'top_20_percent', height: dimensions.height * 0.20 },
      { name: 'top_25_percent', height: dimensions.height * 0.25 }
    ];

    for (const section of sections) {
      const sectionBounds: BoundingBox = {
        x: 0,
        y: 0,
        width: dimensions.width,
        height: Math.floor(section.height)
      };

      const sectionBuffer = await this.pdfProcessor.extractRegion(imagePath, sectionBounds);
      const outputPath = path.join(this.outputDir, `analysis_${section.name}.png`);
      await sharp(sectionBuffer).png().toFile(outputPath);
      console.log(`📝 Saved ${section.name} analysis: ${outputPath}`);
    }
  }

  /**
   * Analyze color distribution across the image
   */
  private async analyzeColorDistribution(imagePath: string, dimensions: { width: number; height: number }): Promise<void> {
    console.log('🌈 Analyzing color distribution...');
    
    const image = sharp(imagePath);
    const rawBuffer = await image.raw().toBuffer();
    const channels = 3;
    
    // Sample colors from different regions
    const colorSamples: Array<{ x: number; y: number; color: { r: number; g: number; b: number } }> = [];
    
    // Sample in a grid pattern
    const sampleStep = 50;
    for (let y = 0; y < dimensions.height; y += sampleStep) {
      for (let x = 0; x < dimensions.width; x += sampleStep) {
        const pixelIndex = (y * dimensions.width + x) * channels;
        if (pixelIndex + 2 < rawBuffer.length) {
          const color = {
            r: rawBuffer[pixelIndex],
            g: rawBuffer[pixelIndex + 1],
            b: rawBuffer[pixelIndex + 2]
          };
          colorSamples.push({ x, y, color });
        }
      }
    }

    // Find interesting color regions (non-white, non-black)
    const interestingColors = colorSamples.filter(sample => {
      const brightness = (sample.color.r + sample.color.g + sample.color.b) / 3;
      return brightness > 30 && brightness < 230;
    });

    console.log(`📊 Found ${interestingColors.length} interesting color samples out of ${colorSamples.length} total`);
    
    // Group by regions
    const topRegionColors = interestingColors.filter(sample => sample.y < dimensions.height * 0.2);
    console.log(`🎯 Found ${topRegionColors.length} interesting colors in top 20%`);

    // Save color distribution as JSON
    const colorDistribution = {
      total_samples: colorSamples.length,
      interesting_colors: interestingColors.length,
      top_region_colors: topRegionColors.length,
      sample_colors: topRegionColors.slice(0, 50).map(sample => ({
        position: { x: sample.x, y: sample.y },
        color: sample.color,
        hex: this.rgbToHex(sample.color.r, sample.color.g, sample.color.b)
      }))
    };

    fs.writeFileSync(
      path.join(this.outputDir, 'color_distribution_analysis.json'),
      JSON.stringify(colorDistribution, null, 2)
    );
  }

  /**
   * Find rectangular regions that might be color boxes
   */
  private async findRectangularRegions(imagePath: string, dimensions: { width: number; height: number }): Promise<void> {
    console.log('📦 Finding rectangular regions...');
    
    const topSection: BoundingBox = {
      x: 0,
      y: 0,
      width: dimensions.width,
      height: Math.floor(dimensions.height * 0.2)
    };

    const sectionBuffer = await this.pdfProcessor.extractRegion(imagePath, topSection);
    const image = sharp(sectionBuffer);
    const { width: sectionWidth, height: sectionHeight } = await image.metadata();
    
    if (!sectionWidth || !sectionHeight) return;

    const rawBuffer = await image.raw().toBuffer();
    const channels = 3;
    
    // Find regions with consistent colors
    const candidateRegions: Array<{ x: number; y: number; width: number; height: number; avgColor: { r: number; g: number; b: number } }> = [];
    
    const regionSize = 50;
    for (let y = 0; y < sectionHeight - regionSize; y += 25) {
      for (let x = 0; x < sectionWidth - regionSize; x += 25) {
        const samples: Array<{ r: number; g: number; b: number }> = [];
        
        // Sample pixels in this region
        for (let dy = 0; dy < regionSize; dy += 10) {
          for (let dx = 0; dx < regionSize; dx += 10) {
            const pixelIndex = ((y + dy) * sectionWidth + (x + dx)) * channels;
            if (pixelIndex + 2 < rawBuffer.length) {
              samples.push({
                r: rawBuffer[pixelIndex],
                g: rawBuffer[pixelIndex + 1],
                b: rawBuffer[pixelIndex + 2]
              });
            }
          }
        }

        if (samples.length > 0) {
          const avgColor = this.calculateAverageColor(samples);
          const variance = this.calculateColorVariance(samples, avgColor);
          
          // Check if this region has consistent color
          if (variance < 2000) {
            const brightness = (avgColor.r + avgColor.g + avgColor.b) / 3;
            if (brightness > 40 && brightness < 240) {
              candidateRegions.push({
                x,
                y,
                width: regionSize,
                height: regionSize,
                avgColor
              });
            }
          }
        }
      }
    }

    console.log(`🎯 Found ${candidateRegions.length} candidate rectangular regions`);
    
    // Save regions analysis
    const regionsAnalysis = {
      total_regions: candidateRegions.length,
      regions: candidateRegions.slice(0, 20).map(region => ({
        position: { x: region.x, y: region.y },
        size: { width: region.width, height: region.height },
        color: region.avgColor,
        hex: this.rgbToHex(region.avgColor.r, region.avgColor.g, region.avgColor.b)
      }))
    };

    fs.writeFileSync(
      path.join(this.outputDir, 'rectangular_regions_analysis.json'),
      JSON.stringify(regionsAnalysis, null, 2)
    );
  }

  /**
   * Analyze text regions in the image
   */
  private async analyzeTextRegions(imagePath: string, dimensions: { width: number; height: number }): Promise<void> {
    console.log('📝 Analyzing text regions...');
    
    // Extract top section for text analysis
    const topSection: BoundingBox = {
      x: 0,
      y: 0,
      width: dimensions.width,
      height: Math.floor(dimensions.height * 0.2)
    };

    const sectionBuffer = await this.pdfProcessor.extractRegion(imagePath, topSection);
    
    // Create a high-contrast version for better text detection
    const highContrast = await sharp(sectionBuffer)
      .greyscale()
      .threshold(128)
      .png()
      .toBuffer();

    const highContrastPath = path.join(this.outputDir, 'high_contrast_text_analysis.png');
    await sharp(highContrast).png().toFile(highContrastPath);
    console.log(`📄 Saved high contrast text analysis: ${highContrastPath}`);
  }

  /**
   * Calculate average color from samples
   */
  private calculateAverageColor(samples: Array<{ r: number; g: number; b: number }>): { r: number; g: number; b: number } {
    if (samples.length === 0) return { r: 0, g: 0, b: 0 };
    
    const sum = samples.reduce((acc, sample) => ({
      r: acc.r + sample.r,
      g: acc.g + sample.g,
      b: acc.b + sample.b
    }), { r: 0, g: 0, b: 0 });
    
    return {
      r: Math.round(sum.r / samples.length),
      g: Math.round(sum.g / samples.length),
      b: Math.round(sum.b / samples.length)
    };
  }

  /**
   * Calculate color variance
   */
  private calculateColorVariance(samples: Array<{ r: number; g: number; b: number }>, avgColor: { r: number; g: number; b: number }): number {
    if (samples.length === 0) return 0;
    
    const variance = samples.reduce((acc, sample) => {
      const dr = sample.r - avgColor.r;
      const dg = sample.g - avgColor.g;
      const db = sample.b - avgColor.b;
      return acc + (dr * dr + dg * dg + db * db);
    }, 0);
    
    return variance / samples.length;
  }

  /**
   * Convert RGB to hex
   */
  private rgbToHex(r: number, g: number, b: number): string {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
  }
} 