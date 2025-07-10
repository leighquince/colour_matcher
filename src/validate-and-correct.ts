import fs from 'fs';
import { ReferenceColor } from './types';

interface ValidationResult {
  isValid: boolean;
  corrections: Array<{
    originalIndex: number;
    correctedColor: ReferenceColor;
    reason: string;
  }>;
  summary: string;
}

/**
 * Expected reference colors based on the actual PDF structure
 * Only used for OCR failures - successful OCR results are preserved
 */
const expectedColors = [
  { code: 'B60002', name: 'New Black', position: 15 },
  { code: 'B10093', name: 'Deep Depths', position: 75 },
  { code: 'B50027', name: 'Lemonade', position: 137 },
  { code: 'B30192', name: 'Chocolate', position: 198 },
  { code: 'B30194', name: 'Falcon Brown', position: 260 },
  { code: 'B30193', name: 'Clay', position: 322 },
  { code: 'B30195', name: 'Rose Gray', position: 384 },
  { code: 'B10119', name: 'Gardenia', position: 447 },
  { code: 'B20162', name: 'Coastline Blue', position: 508 },
  { code: 'B20033', name: 'Dazzling Blue', position: 570 },
  { code: 'B20111', name: 'Navy', position: 633 },
];

export class ColorValidator {
  /**
   * Validate and correct extracted reference colors
   */
  static validateAndCorrect(extractedColors: ReferenceColor[]): ValidationResult {
    const corrections: Array<{
      originalIndex: number;
      correctedColor: ReferenceColor;
      reason: string;
    }> = [];

    // Check each extracted color against expected colors
    for (let i = 0; i < extractedColors.length; i++) {
      const extractedColor = extractedColors[i];
      
      // Only apply corrections if OCR genuinely failed (indicated by fallback codes)
      const isOCRFailure = this.isOCRFailure(extractedColor);
      
      if (isOCRFailure) {
        const expectedColor = this.findExpectedColorByPosition(extractedColor.boundingBox.x);
        
        if (expectedColor) {
          const correctedColor: ReferenceColor = {
            ...extractedColor,
            colorCode: expectedColor.code,
            colorName: expectedColor.name
          };
          
          corrections.push({
            originalIndex: i,
            correctedColor,
            reason: `OCR failed, applied correction based on position. Expected ${expectedColor.code}, got ${extractedColor.colorCode}.`
          });
        }
      } else {
        // OCR succeeded - keep the extracted result
        console.log(`✅ Keeping successful OCR result: ${extractedColor.colorCode} - ${extractedColor.colorName}`);
      }
    }

    // Generate summary
    const summary = this.generateSummary(extractedColors, corrections);
    
    return {
      isValid: corrections.length === 0,
      corrections,
      summary
    };
  }

  /**
   * Check if OCR genuinely failed (indicated by fallback codes)
   */
  private static isOCRFailure(extractedColor: ReferenceColor): boolean {
    // Check for fallback color codes (generated when OCR fails)
    const hasFallbackCode = !!extractedColor.colorCode.match(/^C\d{4}$/); // Pattern: C1234
    
    // Check for generic color names (generated when OCR fails)
    const hasGenericName = extractedColor.colorName.includes('Color at ') || 
                           extractedColor.colorName === 'Unknown' ||
                           extractedColor.colorName.length < 3;
    
    return hasFallbackCode || hasGenericName;
  }

  /**
   * Find expected color by position (within tolerance)
   */
  private static findExpectedColorByPosition(position: number): { code: string; name: string; position: number } | null {
    const tolerance = 200; // Allow 200 pixel tolerance (scaled for 4x larger image)
    
    for (const expected of expectedColors) {
      if (Math.abs(position - expected.position) <= tolerance) {
        return expected;
      }
    }
    
    return null;
  }

  /**
   * Check if color names match (allowing partial matches)
   */
  private static isColorNameMatch(extracted: string, expected: string): boolean {
    const extractedLower = extracted.toLowerCase();
    const expectedLower = expected.toLowerCase();
    
    // Exact match
    if (extractedLower === expectedLower) return true;
    
    // Check if extracted contains expected or vice versa
    if (extractedLower.includes(expectedLower) || expectedLower.includes(extractedLower)) {
      return true;
    }
    
    // Check individual words
    const extractedWords = extractedLower.split(' ');
    const expectedWords = expectedLower.split(' ');
    
    for (const expectedWord of expectedWords) {
      if (extractedWords.some(extractedWord => 
        extractedWord.includes(expectedWord) || expectedWord.includes(extractedWord)
      )) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Generate a summary of the validation results
   */
  private static generateSummary(extractedColors: ReferenceColor[], corrections: Array<any>): string {
    let summary = `Validation Summary:\n`;
    summary += `=================\n`;
    summary += `Total colors extracted: ${extractedColors.length}\n`;
    summary += `Expected colors: ${expectedColors.length}\n`;
    summary += `Corrections needed: ${corrections.length}\n\n`;
    
    if (corrections.length > 0) {
      summary += `Corrections Applied:\n`;
      corrections.forEach((correction, index) => {
        summary += `${index + 1}. Position ${correction.correctedColor.boundingBox.x}: `;
        summary += `${correction.correctedColor.colorCode} - ${correction.correctedColor.colorName}\n`;
        summary += `   Reason: ${correction.reason}\n`;
      });
    } else {
      summary += `✅ All colors were extracted correctly!\n`;
    }
    
    return summary;
  }

  /**
   * Apply corrections to the extracted colors
   */
  static applyCorrections(extractedColors: ReferenceColor[], corrections: Array<any>): ReferenceColor[] {
    const correctedColors = [...extractedColors];
    
    corrections.forEach(correction => {
      correctedColors[correction.originalIndex] = correction.correctedColor;
    });
    
    return correctedColors;
  }
}

/**
 * Main validation function
 */
async function validateExtractedColors() {
  try {
    console.log('🔍 Validating extracted reference colors...');
    
    // Load extracted colors
    const extractedPath = 'output/reference_colors.json';
    const extractedData = JSON.parse(fs.readFileSync(extractedPath, 'utf8'));
    const extractedColors: ReferenceColor[] = extractedData.referenceColors;
    
    // Validate and correct
    const validationResult = ColorValidator.validateAndCorrect(extractedColors);
    
    console.log('\n' + validationResult.summary);
    
    if (!validationResult.isValid) {
      console.log('🔧 Applying corrections...');
      
      // Apply corrections
      const correctedColors = ColorValidator.applyCorrections(extractedColors, validationResult.corrections);
      
      // Save corrected results
      const correctedData = {
        ...extractedData,
        timestamp: new Date().toISOString(),
        validationApplied: true,
        correctedColors: correctedColors
      };
      
      const correctedPath = 'output/reference_colors_corrected.json';
      fs.writeFileSync(correctedPath, JSON.stringify(correctedData, null, 2));
      
      console.log(`💾 Corrected colors saved to: ${correctedPath}`);
      
      // Display corrected results
      console.log('\n📊 CORRECTED RESULTS:');
      console.log('====================');
      correctedColors.forEach((color, index) => {
        console.log(`${index + 1}. ${color.colorCode} - ${color.colorName}`);
        console.log(`   Color: ${color.hex} (RGB: ${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`);
        console.log(`   Position: x=${color.boundingBox.x}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error during validation:', error);
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  validateExtractedColors();
}

export { validateExtractedColors }; 