import { ReferenceColor, SwatchGroup, ColorBox } from './types';

export interface MatchedColor {
  rgb: { r: number; g: number; b: number };
  hex: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  bottomRightPixel: { r: number; g: number; b: number };
  matchedReference: {
    colorCode: string;
    colorName: string;
    pantoneColor: string;
    distance: number;
    confidence: number;
  };
}

export interface MatchedSwatch {
  styleNumber: string;
  styleName: string;
  colors: MatchedColor[];
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface ColorMatchingResult {
  timestamp: string;
  totalSwatches: number;
  totalColors: number;
  totalReferenceColors: number;
  matchingMethod: string;
  swatches: MatchedSwatch[];
  referenceColors: ReferenceColor[];
}

export class ColorMatcher {
  private referenceColors: ReferenceColor[];
  private maxDistance: number;

  constructor(referenceColors: ReferenceColor[], maxDistance: number = 150) {
    this.referenceColors = referenceColors;
    this.maxDistance = maxDistance; // Maximum color distance for a match to be considered valid
  }

  /**
   * Calculate Euclidean distance between two RGB colors
   */
  private static calculateColorDistance(
    color1: { r: number; g: number; b: number },
    color2: { r: number; g: number; b: number }
  ): number {
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /**
   * Find the closest reference color for a given swatch color
   */
  private findClosestReferenceColor(swatchColor: ColorBox): {
    reference: ReferenceColor;
    distance: number;
    confidence: number;
  } | null {
    if (this.referenceColors.length === 0) {
      return null;
    }

    let closestReference: ReferenceColor | null = null;
    let minDistance = Infinity;

    for (const referenceColor of this.referenceColors) {
      const distance = ColorMatcher.calculateColorDistance(swatchColor.rgb, referenceColor.rgb);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestReference = referenceColor;
      }
    }

    if (closestReference && minDistance <= this.maxDistance) {
      // Calculate confidence based on distance (closer = higher confidence)
      const confidence = Math.max(0, Math.min(100, 100 - (minDistance / this.maxDistance) * 100));
      
      return {
        reference: closestReference,
        distance: minDistance,
        confidence: Math.round(confidence * 100) / 100
      };
    }

    return null;
  }

  /**
   * Match all swatches with reference colors
   */
  public matchSwatchesWithReferences(swatches: SwatchGroup[]): ColorMatchingResult {
    console.log(`🎯 Starting color matching for ${swatches.length} swatches with ${this.referenceColors.length} reference colors`);
    
    const matchedSwatches: MatchedSwatch[] = [];
    let totalColors = 0;
    let matchedColorsCount = 0;
    let unmatchedColorsCount = 0;

    for (const swatch of swatches) {
      const matchedColors: MatchedColor[] = [];
      
      for (const color of swatch.colors) {
        totalColors++;
        
        const match = this.findClosestReferenceColor(color);
        
        if (match) {
          matchedColors.push({
            rgb: color.rgb,
            hex: color.hex,
            boundingBox: color.boundingBox,
            bottomRightPixel: color.bottomRightPixel,
            matchedReference: {
              colorCode: match.reference.colorCode,
              colorName: match.reference.colorName,
              pantoneColor: match.reference.pantoneColor,
              distance: Math.round(match.distance * 100) / 100,
              confidence: match.confidence
            }
          });
          matchedColorsCount++;
        } else {
          // No match found within acceptable distance
          matchedColors.push({
            rgb: color.rgb,
            hex: color.hex,
            boundingBox: color.boundingBox,
            bottomRightPixel: color.bottomRightPixel,
            matchedReference: {
              colorCode: 'UNKNOWN',
              colorName: 'No Match Found',
              pantoneColor: 'N/A',
              distance: -1,
              confidence: 0
            }
          });
          unmatchedColorsCount++;
        }
      }

      matchedSwatches.push({
        styleNumber: swatch.styleNumber,
        styleName: swatch.styleName,
        colors: matchedColors,
        boundingBox: swatch.boundingBox
      });
    }

    console.log(`✅ Color matching complete:`);
    console.log(`   - Total colors processed: ${totalColors}`);
    console.log(`   - Successfully matched: ${matchedColorsCount}`);
    console.log(`   - Unmatched colors: ${unmatchedColorsCount}`);
    console.log(`   - Match rate: ${Math.round((matchedColorsCount / totalColors) * 100)}%`);

    return {
      timestamp: new Date().toISOString(),
      totalSwatches: swatches.length,
      totalColors: totalColors,
      totalReferenceColors: this.referenceColors.length,
      matchingMethod: `Euclidean Distance (max distance: ${this.maxDistance})`,
      swatches: matchedSwatches,
      referenceColors: this.referenceColors
    };
  }

  /**
   * Get matching statistics
   */
  public getMatchingStats(result: ColorMatchingResult): {
    totalColors: number;
    matchedColors: number;
    unmatchedColors: number;
    matchRate: number;
    averageDistance: number;
    averageConfidence: number;
    referenceColorUsage: { [key: string]: number };
  } {
    let totalColors = 0;
    let matchedColors = 0;
    let unmatchedColors = 0;
    let totalDistance = 0;
    let totalConfidence = 0;
    const referenceColorUsage: { [key: string]: number } = {};

    for (const swatch of result.swatches) {
      for (const color of swatch.colors) {
        totalColors++;
        
        if (color.matchedReference.colorCode !== 'UNKNOWN') {
          matchedColors++;
          totalDistance += color.matchedReference.distance;
          totalConfidence += color.matchedReference.confidence;
          
          const key = `${color.matchedReference.colorCode} - ${color.matchedReference.colorName}`;
          referenceColorUsage[key] = (referenceColorUsage[key] || 0) + 1;
        } else {
          unmatchedColors++;
        }
      }
    }

    return {
      totalColors,
      matchedColors,
      unmatchedColors,
      matchRate: Math.round((matchedColors / totalColors) * 100 * 100) / 100,
      averageDistance: matchedColors > 0 ? Math.round((totalDistance / matchedColors) * 100) / 100 : 0,
      averageConfidence: matchedColors > 0 ? Math.round((totalConfidence / matchedColors) * 100) / 100 : 0,
      referenceColorUsage
    };
  }

  /**
   * Print detailed matching results
   */
  public printMatchingResults(result: ColorMatchingResult): void {
    console.log('\n🎨 DETAILED COLOR MATCHING RESULTS');
    console.log('==================================');
    
    const stats = this.getMatchingStats(result);
    
    console.log(`📊 Overall Statistics:`);
    console.log(`   Total Colors: ${stats.totalColors}`);
    console.log(`   Matched Colors: ${stats.matchedColors}`);
    console.log(`   Unmatched Colors: ${stats.unmatchedColors}`);
    console.log(`   Match Rate: ${stats.matchRate}%`);
    console.log(`   Average Distance: ${stats.averageDistance}`);
    console.log(`   Average Confidence: ${stats.averageConfidence}%`);
    console.log('');

    console.log(`📈 Reference Color Usage:`);
    const sortedUsage = Object.entries(stats.referenceColorUsage)
      .sort(([,a], [,b]) => b - a);
    
    for (const [colorName, count] of sortedUsage) {
      console.log(`   ${colorName}: ${count} times`);
    }
    console.log('');

    console.log(`🧩 Swatch Details:`);
    for (const swatch of result.swatches) {
      console.log(`   ${swatch.styleNumber} - ${swatch.styleName}`);
      for (const color of swatch.colors) {
        if (color.matchedReference.colorCode !== 'UNKNOWN') {
          console.log(`     ✅ ${color.hex} → ${color.matchedReference.colorCode} (${color.matchedReference.colorName})`);
          console.log(`        Distance: ${color.matchedReference.distance}, Confidence: ${color.matchedReference.confidence}%`);
        } else {
          console.log(`     ❌ ${color.hex} → No match found`);
        }
      }
      console.log('');
    }
  }
} 