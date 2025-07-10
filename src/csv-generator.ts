import fs from 'fs';
import path from 'path';

interface ColorMatch {
  styleNumber: string;
  styleName: string;
  colors: {
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
  }[];
  boundingBox: { x: number; y: number; width: number; height: number };
}

interface ColorMatchingResult {
  timestamp: string;
  totalSwatches: number;
  totalColors: number;
  totalReferenceColors: number;
  matchingMethod: string;
  swatches: ColorMatch[];
}

export class CSVGenerator {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Generate CSV file with style numbers and color codes
   */
  async generateStyleColorCSV(): Promise<void> {
    console.log('📊 Generating CSV file with style numbers and color codes...');
    
    const colorMatchesPath = path.join(this.outputDir, 'color_matches.json');
    
    if (!fs.existsSync(colorMatchesPath)) {
      throw new Error(`Color matches file not found: ${colorMatchesPath}`);
    }

    // Read the color matches data
    const colorMatchesData: ColorMatchingResult = JSON.parse(
      fs.readFileSync(colorMatchesPath, 'utf-8')
    );

    // Generate CSV rows
    const csvRows: string[] = [];
    
    // Add header
    csvRows.push('Style Number,Color Code');

    // Process each swatch
    for (const swatch of colorMatchesData.swatches) {
      const styleNumber = swatch.styleNumber;
      
      // For each color in the swatch, create a row
      for (const color of swatch.colors) {
        const colorCode = color.matchedReference.colorCode;
        csvRows.push(`${styleNumber},${colorCode}`);
      }
    }

    // Write CSV file
    const csvPath = path.join(this.outputDir, 'style_color_mapping.csv');
    fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf-8');

    console.log(`✅ CSV file generated: ${csvPath}`);
    console.log(`📄 Total rows: ${csvRows.length - 1} (excluding header)`);
    console.log(`🎨 Total swatches processed: ${colorMatchesData.totalSwatches}`);
    console.log(`🌈 Total colors processed: ${colorMatchesData.totalColors}`);
    
    // Show first few rows as preview
    console.log('\n📋 CSV Preview:');
    console.log(csvRows.slice(0, 11).join('\n'));
    
    if (csvRows.length > 11) {
      console.log(`... and ${csvRows.length - 11} more rows`);
    }
  }

  /**
   * Generate detailed CSV with additional information
   */
  async generateDetailedCSV(): Promise<void> {
    console.log('📊 Generating detailed CSV file...');
    
    const colorMatchesPath = path.join(this.outputDir, 'color_matches.json');
    
    if (!fs.existsSync(colorMatchesPath)) {
      throw new Error(`Color matches file not found: ${colorMatchesPath}`);
    }

    // Read the color matches data
    const colorMatchesData: ColorMatchingResult = JSON.parse(
      fs.readFileSync(colorMatchesPath, 'utf-8')
    );

    // Generate CSV rows
    const csvRows: string[] = [];
    
    // Add header
    csvRows.push('Style Number,Style Name,Color Code,Color Name,Pantone Color,RGB Hex,Confidence %');

    // Process each swatch
    for (const swatch of colorMatchesData.swatches) {
      const styleNumber = swatch.styleNumber;
      const styleName = swatch.styleName;
      
      // For each color in the swatch, create a row
      for (const color of swatch.colors) {
        const colorCode = color.matchedReference.colorCode;
        const colorName = color.matchedReference.colorName;
        const pantoneColor = color.matchedReference.pantoneColor;
        const rgbHex = color.hex;
        const confidence = color.matchedReference.confidence.toFixed(1);
        
        // Remove commas from text fields to avoid CSV parsing issues
        const cleanStyleName = styleName.replace(/,/g, '');
        const cleanColorName = colorName.replace(/,/g, '');
        
        csvRows.push(`${styleNumber},${cleanStyleName},${colorCode},${cleanColorName},${pantoneColor},${rgbHex},${confidence}`);
      }
    }

    // Write CSV file
    const csvPath = path.join(this.outputDir, 'detailed_style_color_mapping.csv');
    fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf-8');

    console.log(`✅ Detailed CSV file generated: ${csvPath}`);
    console.log(`📄 Total rows: ${csvRows.length - 1} (excluding header)`);
    
    // Show first few rows as preview
    console.log('\n📋 Detailed CSV Preview:');
    console.log(csvRows.slice(0, 6).join('\n'));
    
    if (csvRows.length > 6) {
      console.log(`... and ${csvRows.length - 6} more rows`);
    }
  }
} 