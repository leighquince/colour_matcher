import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { SwatchGroup, ColorBox, BoundingBox } from './types';
import { PDFProcessor } from './pdf-processor';
import path from 'path';

interface RowBoundary {
  startY: number;
  endY: number;
  height: number;
}

export class SwatchExtractor {
  private pdfProcessor: PDFProcessor;
  private debugMode: boolean;

  constructor(pdfProcessor: PDFProcessor, debugMode: boolean = false) {
    this.pdfProcessor = pdfProcessor;
    this.debugMode = debugMode;
  }

  /**
   * Extract swatches starting below the red anchor boxes
   */
  async extractSwatches(
    imagePath: string, 
    redAnchorBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>
  ): Promise<SwatchGroup[]> {
    console.log('🧩 Starting simplified swatch extraction...');
    
    const dimensions = await this.pdfProcessor.getImageDimensions(imagePath);
    console.log(`📐 Image dimensions: ${dimensions.width}x${dimensions.height}`);

    // Find the starting Y position below the last red anchor box
    const startY = this.findSwatchStartingPosition(redAnchorBoxes, dimensions);
    console.log(`🔽 Starting swatch scan at Y position: ${startY}`);

    // Detect rows first
    const rows = await this.detectRows(imagePath, startY, dimensions);
    console.log(`📏 Detected ${rows.length} rows`);

    // Extract starting portions of each row for verification
    const swatches = await this.extractRowStartingPortions(imagePath, rows, dimensions);
    
    console.log(`✅ Successfully extracted ${swatches.length} row starting portions`);
    return swatches;
  }

  /**
   * Find the starting Y position for swatch scanning (below the last red anchor box)
   */
  private findSwatchStartingPosition(
    redAnchorBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>,
    dimensions: { width: number; height: number }
  ): number {
    if (redAnchorBoxes.length === 0) {
      console.log('⚠️  No red anchor boxes found, starting from top');
      return 0;
    }

    // Find the bottom of the last red anchor box
    const lastRedBox = redAnchorBoxes.reduce((latest, current) => 
      (current.y + current.height > latest.y + latest.height) ? current : latest
    );
    
    const startY = lastRedBox.y + lastRedBox.height + 200; // Add larger margin to skip past reference color area
    console.log(`🔴 Last red anchor box ends at Y=${lastRedBox.y + lastRedBox.height}, starting swatch scan at Y=${startY} (skipping reference color area)`);
    
    return Math.min(startY, dimensions.height - 100); // Ensure we don't start too close to the bottom
  }

  /**
   * Detect rows by scanning vertically from a fixed X position
   */
  private async detectRows(
    imagePath: string,
    startY: number,
    dimensions: { width: number; height: number }
  ): Promise<RowBoundary[]> {
    console.log('🔍 Detecting rows using vertical scanning...');
    
    const scanX = 100; // Fixed X position for scanning
    console.log(`📍 Using scanning X position: ${scanX}`);

    // Load image for pixel analysis
    const imageBuffer = await sharp(imagePath).raw().toBuffer();
    const { width, height, channels } = await sharp(imagePath).metadata();
    
    if (!width || !height || !channels) {
      throw new Error('Could not get image metadata');
    }

    const rows: RowBoundary[] = [];
    let currentY = startY;
    let rowCount = 0;
    const whiteSpaceThreshold = 50; // Minimum white space height to consider row ended

    while (currentY < height - 100) {
      rowCount++;
      console.log(`📏 Looking for row ${rowCount} starting from Y=${currentY}...`);

      // Find start of row (first non-white pixel)
      const rowStart = await this.findRowStart(imageBuffer, width, height, channels, scanX, currentY);
      
      if (rowStart === null) {
        console.log(`   No more rows found after Y=${currentY}`);
        break;
      }

      console.log(`   Row ${rowCount} starts at Y=${rowStart}`);

      // Find end of row (large white space)
      const rowEnd = await this.findRowEnd(imageBuffer, width, height, channels, scanX, rowStart, whiteSpaceThreshold);
      
      if (rowEnd === null) {
        console.log(`   Row ${rowCount} extends to end of image`);
        break;
      }

      console.log(`   Row ${rowCount} ends at Y=${rowEnd} (height: ${rowEnd - rowStart}px)`);

      rows.push({
        startY: rowStart,
        endY: rowEnd,
        height: rowEnd - rowStart
      });

      // Move to next potential row start
      currentY = rowEnd + 1;
    }

    console.log(`✅ Found ${rows.length} rows`);
    return rows;
  }

  /**
   * Find the start of a row by scanning down from currentY until we hit non-white pixels
   */
  private async findRowStart(
    imageBuffer: Buffer,
    width: number,
    height: number,
    channels: number,
    scanX: number,
    startY: number
  ): Promise<number | null> {
    for (let y = startY; y < height - 10; y++) {
      const pixelIndex = (y * width + scanX) * channels;
      const r = imageBuffer[pixelIndex];
      const g = imageBuffer[pixelIndex + 1];
      const b = imageBuffer[pixelIndex + 2];
      
      // Check if this pixel is non-white (has some content)
      if (!this.isWhiteOrNearWhite({ r, g, b })) {
        // Add a generous margin above the first detected content to ensure we capture complete text
        // This accounts for multi-line text and taller fonts
        const textMargin = 45; // Increased from 20 to 60 pixels above the first non-white pixel
        return Math.max(0, y - textMargin);
      }
    }
    
    return null;
  }

  /**
   * Find the end of a row by scanning down from rowStart until we hit a large white space
   */
  private async findRowEnd(
    imageBuffer: Buffer,
    width: number,
    height: number,
    channels: number,
    scanX: number,
    rowStart: number,
    whiteSpaceThreshold: number
  ): Promise<number | null> {
    let consecutiveWhitePixels = 0;
    
    for (let y = rowStart; y < height - 10; y++) {
      const pixelIndex = (y * width + scanX) * channels;
      const r = imageBuffer[pixelIndex];
      const g = imageBuffer[pixelIndex + 1];
      const b = imageBuffer[pixelIndex + 2];
      
      if (this.isWhiteOrNearWhite({ r, g, b })) {
        consecutiveWhitePixels++;
        
        // If we hit the threshold, this is the end of the row
        if (consecutiveWhitePixels >= whiteSpaceThreshold) {
          // Ensure the row end is never before the row start
          const rowEnd = y - whiteSpaceThreshold;
          return Math.max(rowEnd, rowStart + 1); // Minimum row height of 1 pixel
        }
      } else {
        consecutiveWhitePixels = 0; // Reset counter when we hit non-white
      }
    }
    
    return null;
  }

    /**
   * Extract individual swatch groups from each detected row
   */
  private async extractRowStartingPortions(
    imagePath: string,
    rows: RowBoundary[],
    dimensions: { width: number; height: number }
  ): Promise<SwatchGroup[]> {
    console.log('🧩 Extracting swatch groups from each detected row...');
    
    const allSwatches: SwatchGroup[] = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;
      
      console.log(`\n📏 Processing row ${rowNumber} (Y=${row.startY}-${row.endY}, height=${row.height}px)...`);
      
      // Find swatch groups within this row
      const rowSwatches = await this.extractSwatchGroupsFromRow(imagePath, row, dimensions, rowNumber);
      
      console.log(`   ✅ Found ${rowSwatches.length} swatch groups in row ${rowNumber}`);
      allSwatches.push(...rowSwatches);
    }
    
    console.log(`\n🎯 Total swatch groups extracted: ${allSwatches.length}`);
    return allSwatches;
  }

  /**
   * Extract individual swatch groups from a single row
   */
  private async extractSwatchGroupsFromRow(
    imagePath: string,
    row: RowBoundary,
    dimensions: { width: number; height: number },
    rowNumber: number
  ): Promise<SwatchGroup[]> {
    const swatches: SwatchGroup[] = [];
    
    // Scan horizontally to find swatch boundaries
    const swatchBoundaries = await this.findSwatchBoundariesInRow(imagePath, row, dimensions);
    
    console.log(`   Found ${swatchBoundaries.length} swatch boundaries in row ${rowNumber}`);
    
    // Extract each swatch group
    for (let i = 0; i < swatchBoundaries.length; i++) {
      const boundary = swatchBoundaries[i];
      const swatchNumber = i + 1;
      
      console.log(`   Extracting swatch ${swatchNumber} from row ${rowNumber} (X=${boundary.startX}-${boundary.endX})...`);
      
      try {
        const swatch = await this.extractSwatchFromBoundary(imagePath, boundary, row, rowNumber, swatchNumber);
        if (swatch) {
          swatches.push(swatch);
          console.log(`   ✅ Successfully extracted: ${swatch.styleNumber} - ${swatch.styleName}`);
        }
      } catch (error) {
        console.warn(`   ⚠️  Failed to extract swatch ${swatchNumber} from row ${rowNumber}:`, error);
      }
    }
    
    return swatches;
  }

  /**
   * Find swatch boundaries within a row by scanning horizontally
   * Swatches extend from their start position to the next swatch start or to the edge
   */
  private async findSwatchBoundariesInRow(
    imagePath: string,
    row: RowBoundary,
    dimensions: { width: number; height: number }
  ): Promise<Array<{ startX: number; endX: number }>> {
    // Load image for pixel analysis
    const imageBuffer = await sharp(imagePath).raw().toBuffer();
    const { width, height, channels } = await sharp(imagePath).metadata();
    
    if (!width || !height || !channels) {
      throw new Error('Could not get image metadata');
    }

    // First pass: find all swatch start positions
    const swatchStarts: number[] = [];
    const scanY = Math.floor(row.startY + row.height * 0.50); // Scan at the transition between text and color boxes
    const minSwatchWidth = 120; // Minimum width for individual swatches
    const whiteSpaceGap = 10; // Smaller gap to detect tight separations between swatch groups
    
    console.log(`   Scanning horizontally at Y=${scanY} (${Math.round(((scanY - row.startY) / row.height) * 100)}% down from row start - closer to color box tops)`);
    
    let currentX = 0;
    let inSwatch = false;
    let consecutiveWhitePixels = 0;
    
    while (currentX < width) {
      const pixelIndex = (scanY * width + currentX) * channels;
      const r = imageBuffer[pixelIndex];
      const g = imageBuffer[pixelIndex + 1];
      const b = imageBuffer[pixelIndex + 2];
      
      const isWhite = this.isWhiteOrNearWhite({ r, g, b });
      
      if (!inSwatch && !isWhite) {
        // Start of a new swatch
        inSwatch = true;
        swatchStarts.push(currentX);
        consecutiveWhitePixels = 0;
      } else if (inSwatch && isWhite) {
        consecutiveWhitePixels++;
        if (consecutiveWhitePixels >= whiteSpaceGap) {
          // End of current swatch area - ready to look for next swatch
          inSwatch = false;
          consecutiveWhitePixels = 0;
        }
      } else if (inSwatch && !isWhite) {
        consecutiveWhitePixels = 0;
      }
      
      currentX++;
    }
    
    console.log(`   Found ${swatchStarts.length} swatch start positions: ${swatchStarts.join(', ')}`);
    
    // Second pass: create boundaries that extend to the next swatch or edge
    const boundaries: Array<{ startX: number; endX: number }> = [];
    
    for (let i = 0; i < swatchStarts.length; i++) {
      const startX = swatchStarts[i];
      let endX: number;
      
      if (i < swatchStarts.length - 1) {
        // Not the last swatch - extend to just before the next swatch starts
        endX = swatchStarts[i + 1] - 1;
      } else {
        // Last swatch - extend to the edge of the image
        endX = width - 1;
      }
      
      const swatchWidth = endX - startX + 1;
      
      // Only include if it meets minimum width requirement
      if (swatchWidth >= minSwatchWidth) {
        boundaries.push({
          startX: startX,
          endX: endX
        });
        console.log(`   Swatch ${i + 1}: X=${startX}-${endX} (width: ${swatchWidth}px)`);
      } else {
        console.log(`   Skipping narrow swatch ${i + 1}: X=${startX}-${endX} (width: ${swatchWidth}px < ${minSwatchWidth}px)`);
      }
    }
    
    return boundaries;
  }

  /**
   * Extract a single swatch from its boundary
   */
  private async extractSwatchFromBoundary(
    imagePath: string,
    boundary: { startX: number; endX: number },
    row: RowBoundary,
    rowNumber: number,
    swatchNumber: number
  ): Promise<SwatchGroup | null> {
    const swatchWidth = boundary.endX - boundary.startX;
    
    // Create bounding box for the complete swatch (text + color boxes)
    const boundingBox: BoundingBox = {
      x: boundary.startX,
      y: row.startY,
      width: swatchWidth,
      height: row.height
    };
    
    try {
      // Extract the swatch image
      const swatchBuffer = await sharp(imagePath)
        .extract({
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height
        })
        .png()
        .toBuffer();
      
      // Save debug image
      const debugPath = path.join('output', `swatch_row${rowNumber}_${swatchNumber}_x${boundary.startX}_w${swatchWidth}.png`);
      await sharp(swatchBuffer).png().toFile(debugPath);
      
      // Extract text from the top portion of the swatch
      const textHeight = Math.floor(row.height * 0.6); // Top 60% for text
      const textBuffer = await sharp(swatchBuffer)
        .extract({
          left: 0,
          top: 0,
          width: swatchWidth,
          height: textHeight
        })
        .png()
        .toBuffer();
      
      // Perform OCR on the text portion
      const result = await Tesseract.recognize(textBuffer, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`     OCR progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
      
      // DEBUG: Show raw OCR data
      console.log(`     🔍 DEBUG: Raw OCR text (before trim): "${result.data.text}"`);
      console.log(`     🔍 DEBUG: Raw OCR text length: ${result.data.text.length}`);
      console.log(`     🔍 DEBUG: Raw OCR text char codes: [${result.data.text.split('').map(c => c.charCodeAt(0)).join(', ')}]`);
      
      const text = result.data.text.trim();
      console.log(`     🔍 DEBUG: OCR result (after trim): "${text}"`);
      console.log(`     🔍 DEBUG: OCR result length: ${text.length}`);
      
      // DEBUG: Show individual lines before parsing
      const debugLines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      console.log(`     🔍 DEBUG: Individual lines count: ${debugLines.length}`);
      debugLines.forEach((line, index) => {
        console.log(`     🔍 DEBUG: Line ${index + 1}: "${line}" (length: ${line.length})`);
        console.log(`     🔍 DEBUG: Line ${index + 1} char codes: [${line.split('').map(c => c.charCodeAt(0)).join(', ')}]`);
      });
      
      const textInfo = this.parseSwatchText(text);
      
      if (!textInfo) {
        console.warn(`     ⚠️  Failed to parse text for swatch ${swatchNumber}`);
        return null;
      }
      
      // Extract colors from the color box area (bottom portion of the swatch)
      const colorBoxArea = await this.extractColorBoxArea(swatchBuffer, swatchWidth, row.height);
      const colors = await this.detectColorsInSwatch(colorBoxArea, swatchWidth, rowNumber, swatchNumber);
      
      console.log(`     Found ${colors.length} colors in swatch`);
      
      // Create swatch group with detected colors
      const swatch: SwatchGroup = {
        styleNumber: textInfo.styleNumber,
        styleName: textInfo.styleName,
        colors: colors,
        boundingBox: boundingBox
      };
      
      return swatch;
      
    } catch (error) {
      console.warn(`     ⚠️  Failed to extract swatch ${swatchNumber}:`, error);
      return null;
    }
  }

  /**
   * Parse swatch text to extract style number and name
   * Simple approach: First 6 characters of first line = style number, second line = style name
   */
  private parseSwatchText(text: string): { styleNumber: string; styleName: string } | null {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) {
      console.log(`     🔍 DEBUG: No lines found in text to parse`);
      return null;
    }
    
    console.log(`     🔍 DEBUG: Parsing swatch text lines: ${JSON.stringify(lines)}`);
    
    let styleNumber = '';
    let styleName = '';
    
    // Extract style number: first 6 characters of first line
    if (lines.length > 0 && lines[0].length >= 6) {
      styleNumber = lines[0].substring(0, 6);
      console.log(`     🔍 DEBUG: Style number (first 6 chars): "${styleNumber}"`);
    }
    
    // Extract style name: second line (if available)
    if (lines.length > 1) {
      styleName = lines[1];
      console.log(`     🔍 DEBUG: Style name (second line): "${styleName}"`);
    }
    
    // Clean up the style name
    if (styleName) {
      styleName = styleName.replace(/[|]/g, '').replace(/\s+/g, ' ').trim();
      console.log(`     🔍 DEBUG: Style name (cleaned): "${styleName}"`);
    }
    
    // Fallback: if no style name found, try to extract from remaining part of first line
    if (!styleName && lines.length > 0) {
      const remainingFirstLine = lines[0].substring(6).trim();
      if (remainingFirstLine.length > 2) {
        styleName = remainingFirstLine;
        console.log(`     🔍 DEBUG: Style name (from first line remainder): "${styleName}"`);
      }
    }
    
    const result = {
      styleNumber: styleNumber || 'Unknown',
      styleName: styleName || 'Unknown'
    };
    
    console.log(`     🔍 DEBUG: Final parsed result: ${JSON.stringify(result)}`);
    console.log(`     🔍 DEBUG: Style number found: "${styleNumber}" (length: ${styleNumber.length})`);
    console.log(`     🔍 DEBUG: Style name found: "${styleName}" (length: ${styleName.length})`);
    
    return result;
  }

  /**
   * Extract the color box area from a swatch by finding where colors actually are
   */
  private async extractColorBoxArea(swatchBuffer: Buffer, swatchWidth: number, swatchHeight: number): Promise<Buffer> {
    // Get raw pixel data of the full swatch to find color boxes
    const { channels } = await sharp(swatchBuffer).metadata();
    const imageBuffer = await sharp(swatchBuffer).raw().toBuffer();
    
    if (!channels) {
      throw new Error('Could not get image channels');
    }
    
    // Find the actual color box area by scanning from the bottom up
    let colorBoxStartY = null;
    let colorBoxEndY = swatchHeight - 1;
    
    // Scan from bottom to top to find the last row with colors
    for (let y = swatchHeight - 1; y >= 0; y--) {
      let hasColor = false;
      
      // Check if this row has any non-white pixels
      for (let x = 0; x < swatchWidth; x++) {
        const pixelIndex = (y * swatchWidth + x) * channels;
        const r = imageBuffer[pixelIndex];
        const g = imageBuffer[pixelIndex + 1];
        const b = imageBuffer[pixelIndex + 2];
        
        if (!this.isWhiteOrNearWhite({ r, g, b })) {
          hasColor = true;
          break;
        }
      }
      
      if (hasColor) {
        colorBoxEndY = y;
        break;
      }
    }
    
    // Now scan from top to find the first row with colors (skipping text area)
    for (let y = Math.floor(swatchHeight * 0.3); y < swatchHeight; y++) {
      let hasColor = false;
      
      // Check if this row has any non-white pixels
      for (let x = 0; x < swatchWidth; x++) {
        const pixelIndex = (y * swatchWidth + x) * channels;
        const r = imageBuffer[pixelIndex];
        const g = imageBuffer[pixelIndex + 1];
        const b = imageBuffer[pixelIndex + 2];
        
        if (!this.isWhiteOrNearWhite({ r, g, b })) {
          hasColor = true;
          break;
        }
      }
      
      if (hasColor && colorBoxStartY === null) {
        colorBoxStartY = y;
        break;
      }
    }
    
    // If no color area found, fall back to bottom 40%
    if (colorBoxStartY === null) {
      colorBoxStartY = Math.floor(swatchHeight * 0.6);
    }
    
    const colorBoxHeight = colorBoxEndY - colorBoxStartY + 1;
    
    return await sharp(swatchBuffer)
      .extract({
        left: 0,
        top: colorBoxStartY,
        width: swatchWidth,
        height: colorBoxHeight
      })
      .png()
      .toBuffer();
  }

  /**
   * Find the actual vertical boundaries of color boxes by detecting solid color areas
   */
  private async findColorBoxVerticalBoundaries(
    imageBuffer: Buffer,
    width: number,
    height: number,
    channels: number,
    colorBoxBounds: { startX: number; endX: number }
  ): Promise<{ startY: number; endY: number } | null> {
    let colorStartY = null;
    let colorEndY = null;
    
    // Skip the top 25% to avoid white borders and focus on solid color area
    const startScanY = Math.floor(height * 0.25);
    
    // First pass: find where solid colors start
    for (let y = startScanY; y < height; y++) {
      let colorPixelCount = 0;
      let totalPixelCount = 0;
      
      // Check what percentage of pixels in this row are solid colors
      for (let x = colorBoxBounds.startX; x < colorBoxBounds.endX; x++) {
        const pixelIndex = (y * width + x) * channels;
        const r = imageBuffer[pixelIndex];
        const g = imageBuffer[pixelIndex + 1];
        const b = imageBuffer[pixelIndex + 2];
        
        totalPixelCount++;
        if (!this.isWhiteOrNearWhite({ r, g, b })) {
          colorPixelCount++;
        }
      }
      
      // If more than 80% of pixels in this row are non-white, consider it solid color
      if (colorPixelCount > totalPixelCount * 0.8 && colorStartY === null) {
        colorStartY = y;
        break;
      }
    }
    
    // Second pass: find where solid colors end
    if (colorStartY !== null) {
      for (let y = height - 1; y >= colorStartY; y--) {
        let colorPixelCount = 0;
        let totalPixelCount = 0;
        
        // Check what percentage of pixels in this row are solid colors
        for (let x = colorBoxBounds.startX; x < colorBoxBounds.endX; x++) {
          const pixelIndex = (y * width + x) * channels;
          const r = imageBuffer[pixelIndex];
          const g = imageBuffer[pixelIndex + 1];
          const b = imageBuffer[pixelIndex + 2];
          
          totalPixelCount++;
          if (!this.isWhiteOrNearWhite({ r, g, b })) {
            colorPixelCount++;
          }
        }
        
        // If more than 80% of pixels in this row are non-white, this is solid color
        if (colorPixelCount > totalPixelCount * 0.8) {
          colorEndY = y;
          break;
        }
      }
    }
    
    if (colorStartY !== null && colorEndY !== null) {
      return { startY: colorStartY, endY: colorEndY };
    }
    
    return null;
  }

  /**
   * Detect individual color boxes within a swatch and extract their colors
   */
  private async detectColorsInSwatch(
    colorBoxArea: Buffer, 
    swatchWidth: number, 
    rowNumber: number, 
    swatchNumber: number
  ): Promise<ColorBox[]> {
    try {
      // Get image metadata
      const { width, height, channels } = await sharp(colorBoxArea).metadata();
      if (!width || !height || !channels) {
        return [];
      }

      // Get raw pixel data
      const imageBuffer = await sharp(colorBoxArea).raw().toBuffer();
      
      // Find color box boundaries by scanning horizontally
      const colorBoxes = await this.findColorBoxBoundaries(imageBuffer, width, height, channels);
      
      const colors: ColorBox[] = [];
      


      // Extract dominant color from each color box
      for (let i = 0; i < colorBoxes.length; i++) {
        const colorBoxBounds = colorBoxes[i];
        
        // Find the actual vertical boundaries of this color box
        const verticalBounds = await this.findColorBoxVerticalBoundaries(
          imageBuffer, 
          width, 
          height, 
          channels, 
          colorBoxBounds
        );
        
        if (verticalBounds) {
          const dominantColor = await this.extractDominantColor(
            imageBuffer, 
            width, 
            height, 
            channels, 
            colorBoxBounds,
            verticalBounds,
            swatchWidth
          );
          
          if (dominantColor) {
            colors.push(dominantColor);
          }
        }
      }
      
      return colors;
      
    } catch (error) {
      console.warn(`     ⚠️  Failed to detect colors in swatch:`, error);
      return [];
    }
  }

  /**
   * Find color box boundaries within the color area
   */
  private async findColorBoxBoundaries(
    imageBuffer: Buffer,
    width: number,
    height: number,
    channels: number
  ): Promise<Array<{ startX: number; endX: number }>> {
    const colorBoxes: Array<{ startX: number; endX: number }> = [];
    const scanY = Math.floor(height * 0.5); // Scan in the middle of color boxes
    const minColorBoxWidth = 15; // Reduced minimum width for smaller color boxes
    const whiteGap = 3; // Smaller gap to detect tighter separations between color boxes
    
    let currentX = 0;
    let inColorBox = false;
    let colorBoxStartX = 0;
    let consecutiveWhitePixels = 0;
    
    while (currentX < width) {
      const pixelIndex = (scanY * width + currentX) * channels;
      const r = imageBuffer[pixelIndex];
      const g = imageBuffer[pixelIndex + 1];
      const b = imageBuffer[pixelIndex + 2];
      
      const isWhite = this.isWhiteOrNearWhite({ r, g, b });
      
      if (!inColorBox && !isWhite) {
        // Start of a new color box
        inColorBox = true;
        colorBoxStartX = currentX;
        consecutiveWhitePixels = 0;
      } else if (inColorBox && isWhite) {
        consecutiveWhitePixels++;
        if (consecutiveWhitePixels >= whiteGap) {
          // End of current color box
          const colorBoxWidth = currentX - colorBoxStartX - consecutiveWhitePixels;
          if (colorBoxWidth >= minColorBoxWidth) {
            colorBoxes.push({
              startX: colorBoxStartX,
              endX: colorBoxStartX + colorBoxWidth
            });
          }
          inColorBox = false;
          consecutiveWhitePixels = 0;
        }
      } else if (inColorBox && !isWhite) {
        consecutiveWhitePixels = 0;
      }
      
      currentX++;
    }
    
    // Handle the last color box if we reached the end
    if (inColorBox) {
      const colorBoxWidth = currentX - colorBoxStartX;
      if (colorBoxWidth >= minColorBoxWidth) {
        colorBoxes.push({
          startX: colorBoxStartX,
          endX: colorBoxStartX + colorBoxWidth
        });
      }
    }
    
    return colorBoxes;
  }

  /**
   * Extract the dominant color from a color box
   */
  private async extractDominantColor(
    imageBuffer: Buffer,
    width: number,
    height: number,
    channels: number,
    colorBoxBounds: { startX: number; endX: number },
    verticalBounds: { startY: number; endY: number },
    swatchWidth: number
  ): Promise<ColorBox | null> {
    try {
      let totalR = 0, totalG = 0, totalB = 0;
      let pixelCount = 0;
      
      // Sample pixels from the actual color box area using detected boundaries
      const sampleStartY = verticalBounds.startY;
      const sampleEndY = verticalBounds.endY;
      
      for (let y = sampleStartY; y <= sampleEndY; y++) {
        for (let x = colorBoxBounds.startX; x < colorBoxBounds.endX; x++) {
          const pixelIndex = (y * width + x) * channels;
          const r = imageBuffer[pixelIndex];
          const g = imageBuffer[pixelIndex + 1];
          const b = imageBuffer[pixelIndex + 2];
          
          // Skip white/near-white pixels
          if (!this.isWhiteOrNearWhite({ r, g, b })) {
            totalR += r;
            totalG += g;
            totalB += b;
            pixelCount++;
          }
        }
      }
      
      if (pixelCount === 0) {
        return null; // No non-white pixels found
      }
      
      // Calculate average color
      const avgR = Math.round(totalR / pixelCount);
      const avgG = Math.round(totalG / pixelCount);
      const avgB = Math.round(totalB / pixelCount);
      
      // Convert to hex
      const hex = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
      
      // Get bottom-right pixel color for the bottomRightPixel field
      const bottomRightX = Math.min(colorBoxBounds.endX - 1, width - 1);
      const bottomRightY = Math.min(verticalBounds.endY, height - 1);
      const bottomRightIndex = (bottomRightY * width + bottomRightX) * channels;
      const bottomRightPixel = {
        r: imageBuffer[bottomRightIndex],
        g: imageBuffer[bottomRightIndex + 1],
        b: imageBuffer[bottomRightIndex + 2]
      };
      
      // Create proper ColorBox object
      const colorBox: ColorBox = {
        rgb: { r: avgR, g: avgG, b: avgB },
        hex: hex,
        boundingBox: {
          x: colorBoxBounds.startX,
          y: verticalBounds.startY, // Actual start position
          width: colorBoxBounds.endX - colorBoxBounds.startX,
          height: verticalBounds.endY - verticalBounds.startY + 1
        },
        bottomRightPixel: bottomRightPixel
      };
      
      return colorBox;
      
    } catch (error) {
      console.warn(`     ⚠️  Failed to extract dominant color:`, error);
      return null;
    }
  }

  /**
   * Check if a color is white or near-white
   */
  private isWhiteOrNearWhite(color: { r: number; g: number; b: number }): boolean {
    const threshold = 240; // Consider colors above this threshold as white
    return color.r > threshold && color.g > threshold && color.b > threshold;
  }
} 