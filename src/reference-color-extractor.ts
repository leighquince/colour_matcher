import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { ReferenceColor, BoundingBox } from './types';
import { PDFProcessor } from './pdf-processor';
import path from 'path';

interface ColorRegion {
  startX: number;
  endX: number;
  avgColor: { r: number; g: number; b: number };
  centerX: number;
  width: number;
}

export class ReferenceColorExtractor {
  private pdfProcessor: PDFProcessor;
  private debugMode: boolean;

  constructor(pdfProcessor: PDFProcessor, debugMode: boolean = false) {
    this.pdfProcessor = pdfProcessor;
    this.debugMode = debugMode;
  }

  /**
   * Extract reference colors using bright red anchor boxes as reference points
   */
  async extractReferenceColors(imagePath: string): Promise<ReferenceColor[]> {
    const result = await this.extractReferenceColorsWithRedBoxes(imagePath);
    return result.referenceColors;
  }

  /**
   * Extract reference colors and return both colors and red anchor boxes
   */
  async extractReferenceColorsWithRedBoxes(imagePath: string): Promise<{
    referenceColors: ReferenceColor[];
    redAnchorBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }> {
    console.log('🎯 Starting reference color extraction using red anchor boxes...');
    
    const dimensions = await this.pdfProcessor.getImageDimensions(imagePath);
    console.log(`📐 Image dimensions: ${dimensions.width}x${dimensions.height}`);

    // Step 1: Find all bright red anchor boxes in the left margin
    const redAnchorBoxes = await this.findRedAnchorBoxes(imagePath);
    console.log(`🔴 Found ${redAnchorBoxes.length} red anchor boxes`);

    if (redAnchorBoxes.length === 0) {
      console.warn('⚠️  No red anchor boxes found! Falling back to percentage-based detection.');
      const fallbackColors = await this.extractColorsWithFallback(imagePath);
      return {
        referenceColors: fallbackColors,
        redAnchorBoxes: []
      };
    }

    // Step 2: For each red anchor box, scan horizontally to find color reference boxes
    const referenceColors: ReferenceColor[] = [];
    
    for (let rowIndex = 0; rowIndex < redAnchorBoxes.length; rowIndex++) {
      const redBox = redAnchorBoxes[rowIndex];
      console.log(`🔍 Processing row ${rowIndex + 1} at Y=${Math.round(redBox.y)} (red box height: ${Math.round(redBox.height)})`);
      
      // Find color boxes in this row using the red box as reference
      const colorBoxes = await this.findColorBoxesInRow(imagePath, redBox);
      console.log(`📦 Found ${colorBoxes.length} color boxes in row ${rowIndex + 1}`);
      
      // Extract color information from each box
      for (let i = 0; i < colorBoxes.length; i++) {
        const box = colorBoxes[i];
        console.log(`🎨 Processing color box ${i + 1}/${colorBoxes.length} at (${Math.round(box.x)}, ${Math.round(box.y)})...`);
        
        try {
          // Create a bounding box for text extraction within the red anchor box area
          // The text should be within the red anchor box, not below the color box
          const textBoundingBox: BoundingBox = {
            x: box.x, // Use original box position
            y: redBox.y, // Start at the top of the red anchor box
            width: box.width, // Use original box width to avoid overlap
            height: redBox.height // Use the full red anchor box height
          };

          const colorInfo = await this.extractColorInfoEnhanced(imagePath, textBoundingBox, box.avgColor);
          if (colorInfo) {
            referenceColors.push(colorInfo);
          }
        } catch (error) {
          console.warn(`⚠️  Failed to extract color info from box ${i + 1} in row ${rowIndex + 1}:`, error);
        }
      }
    }

    console.log(`✅ Successfully extracted ${referenceColors.length} reference colors using red anchor method`);
    return {
      referenceColors,
      redAnchorBoxes
    };
  }

  /**
   * Find red anchor boxes in the image
   */
  private async findRedAnchorBoxes(imagePath: string): Promise<Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>> {
    const image = sharp(imagePath);
    const { width, height } = await image.metadata();
    
    if (!width || !height) {
      throw new Error('Unable to get image dimensions');
    }

    const rawBuffer = await image.raw().toBuffer();
    const channels = 3;
    
    // Scan the left margin (first 10% of image width)
    const leftMarginWidth = Math.floor(width * 0.1);
    console.log(`🔍 Scanning left margin for red anchor boxes (width: ${leftMarginWidth}px)`);
    
    const redPixelMatrix: Array<Array<boolean>> = [];
    for (let y = 0; y < height; y++) {
      redPixelMatrix[y] = [];
      for (let x = 0; x < leftMarginWidth; x++) {
        const pixelIndex = (y * width + x) * channels;
        if (pixelIndex + 2 < rawBuffer.length) {
          const color = {
            r: rawBuffer[pixelIndex],
            g: rawBuffer[pixelIndex + 1],
            b: rawBuffer[pixelIndex + 2]
          };
          redPixelMatrix[y][x] = this.isBrightRedPixel(color);
        } else {
          redPixelMatrix[y][x] = false;
        }
      }
    }
    
    const redBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    
    // Group consecutive red rows into boxes
    let currentBox: { x: number; y: number; width: number; height: number } | null = null;
    
    for (let y = 0; y < height; y++) {
      const redPixelCount = redPixelMatrix[y].filter(Boolean).length;
      const redPixelPercentage = redPixelCount / leftMarginWidth;
      
      if (redPixelPercentage > 0.1) { // Row has significant red pixels
        // Find the leftmost and rightmost red pixels in this row
        const leftmostRed = redPixelMatrix[y].indexOf(true);
        const rightmostRed = redPixelMatrix[y].lastIndexOf(true);
        
        if (leftmostRed !== -1 && rightmostRed !== -1) {
          const rowWidth = rightmostRed - leftmostRed + 1;
          
          if (rowWidth >= 5) { // Minimum width for red box
            if (currentBox === null) {
              // Start a new box
              currentBox = {
                x: leftmostRed,
                y: y,
                width: rowWidth,
                height: 1
              };
            } else {
              // Extend current box
              currentBox.width = Math.max(currentBox.width, rowWidth);
              currentBox.height++;
            }
          } else if (currentBox !== null) {
            // End current box if we have a minimum height
            if (currentBox.height >= 8) {
              redBoxes.push(currentBox);
            }
            currentBox = null;
          }
        }
      } else if (currentBox !== null) {
        // End current box if we have a minimum height
        if (currentBox.height >= 8) {
          redBoxes.push(currentBox);
        }
        currentBox = null;
      }
    }
    
    // Don't forget the last box
    if (currentBox !== null && currentBox.height >= 8) {
      redBoxes.push(currentBox);
    }
    
    console.log(`🔴 Found ${redBoxes.length} red anchor boxes`);
    for (const box of redBoxes) {
      console.log(`   Box at (${box.x}, ${box.y}) size: ${box.width}x${box.height}`);
    }
    
    // Generate debug image showing red anchor boxes
    if (this.debugMode && redBoxes.length > 0) {
      await this.saveRedAnchorBoxDebugImage(imagePath, redBoxes);
    }
    
    return redBoxes;
  }

  /**
   * Save a debug image showing the red anchor boxes with their boundaries
   */
  private async saveRedAnchorBoxDebugImage(imagePath: string, redBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>): Promise<void> {
    try {
      const image = sharp(imagePath);
      const { width, height } = await image.metadata();
      
      if (!width || !height) {
        throw new Error('Unable to get image dimensions');
      }

      // Create a copy of the image to draw on
      const rawBuffer = await image.raw().toBuffer();
      const channels = 3;
      
      // Create a new buffer for the debug image
      const debugBuffer = Buffer.from(rawBuffer);
      
      // Draw prominent bounding boxes around red anchor boxes
      for (const box of redBoxes) {
        console.log(`🎯 Highlighting red anchor box at (${box.x}, ${box.y}) size: ${box.width}x${box.height}`);
        
        // Use bright cyan for high contrast against red
        const borderColor = { r: 0, g: 255, b: 255 }; // Bright cyan
        const borderWidth = 4; // Much thicker border
        
        // Fill the entire box area with a semi-transparent overlay first
        for (let y = box.y; y < box.y + box.height; y++) {
          for (let x = box.x; x < box.x + box.width; x++) {
            if (x >= 0 && x < width && y >= 0 && y < height) {
              const pixelIndex = (y * width + x) * channels;
              if (pixelIndex + 2 < debugBuffer.length) {
                // Mix original color with cyan overlay (50% opacity)
                debugBuffer[pixelIndex] = Math.floor((debugBuffer[pixelIndex] + borderColor.r) / 2);
                debugBuffer[pixelIndex + 1] = Math.floor((debugBuffer[pixelIndex + 1] + borderColor.g) / 2);
                debugBuffer[pixelIndex + 2] = Math.floor((debugBuffer[pixelIndex + 2] + borderColor.b) / 2);
              }
            }
          }
        }
        
        // Draw thick borders
        // Top and bottom borders
        for (let x = Math.max(0, box.x - borderWidth); x <= Math.min(width - 1, box.x + box.width + borderWidth); x++) {
          // Top border
          for (let yOffset = -borderWidth; yOffset <= borderWidth; yOffset++) {
            const y = box.y + yOffset;
            if (y >= 0 && y < height) {
              const pixelIndex = (y * width + x) * channels;
              if (pixelIndex + 2 < debugBuffer.length) {
                debugBuffer[pixelIndex] = borderColor.r;
                debugBuffer[pixelIndex + 1] = borderColor.g;
                debugBuffer[pixelIndex + 2] = borderColor.b;
              }
            }
          }
          
          // Bottom border
          for (let yOffset = -borderWidth; yOffset <= borderWidth; yOffset++) {
            const y = box.y + box.height + yOffset;
            if (y >= 0 && y < height) {
              const pixelIndex = (y * width + x) * channels;
              if (pixelIndex + 2 < debugBuffer.length) {
                debugBuffer[pixelIndex] = borderColor.r;
                debugBuffer[pixelIndex + 1] = borderColor.g;
                debugBuffer[pixelIndex + 2] = borderColor.b;
              }
            }
          }
        }
        
        // Left and right borders
        for (let y = Math.max(0, box.y - borderWidth); y <= Math.min(height - 1, box.y + box.height + borderWidth); y++) {
          // Left border
          for (let xOffset = -borderWidth; xOffset <= borderWidth; xOffset++) {
            const x = box.x + xOffset;
            if (x >= 0 && x < width) {
              const pixelIndex = (y * width + x) * channels;
              if (pixelIndex + 2 < debugBuffer.length) {
                debugBuffer[pixelIndex] = borderColor.r;
                debugBuffer[pixelIndex + 1] = borderColor.g;
                debugBuffer[pixelIndex + 2] = borderColor.b;
              }
            }
          }
          
          // Right border
          for (let xOffset = -borderWidth; xOffset <= borderWidth; xOffset++) {
            const x = box.x + box.width + xOffset;
            if (x >= 0 && x < width) {
              const pixelIndex = (y * width + x) * channels;
              if (pixelIndex + 2 < debugBuffer.length) {
                debugBuffer[pixelIndex] = borderColor.r;
                debugBuffer[pixelIndex + 1] = borderColor.g;
                debugBuffer[pixelIndex + 2] = borderColor.b;
              }
            }
          }
        }
      }
      
      // Save the debug image
      const debugImagePath = path.join(path.dirname(imagePath), '../output/debug_red_anchor_boxes.png');
      await sharp(debugBuffer, { raw: { width, height, channels } })
        .png()
        .toFile(debugImagePath);
      
      console.log(`📸 Red anchor box debug image saved: ${debugImagePath}`);
      
      // Also create a cropped version focusing on the left margin
      const leftMarginWidth = Math.floor(width * 0.15); // Show 15% of the width
      const croppedImagePath = path.join(path.dirname(imagePath), '../output/debug_red_anchor_boxes_cropped.png');
      
      await sharp(debugBuffer, { raw: { width, height, channels } })
        .extract({ left: 0, top: 0, width: leftMarginWidth, height: height })
        .png()
        .toFile(croppedImagePath);
      
      console.log(`📸 Red anchor box cropped debug image saved: ${croppedImagePath}`);
      
    } catch (error) {
      console.warn('Failed to save red anchor box debug image:', error);
    }
  }

  /**
   * Check if a pixel is bright red (anchor box color)
   */
  private isBrightRedPixel(color: { r: number; g: number; b: number }): boolean {
    // Look for bright red pixels (high red, low green and blue)
    return color.r > 180 && color.g < 100 && color.b < 100;
  }

  /**
   * Find color boxes in a row using the red anchor box as reference
   * Scans horizontally looking for white-to-color transitions to identify box boundaries
   */
  private async findColorBoxesInRow(imagePath: string, redBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    avgColor: { r: number; g: number; b: number };
  }>> {
    const image = sharp(imagePath);
    const { width, height } = await image.metadata();
    
    if (!width || !height) {
      throw new Error('Unable to get image dimensions');
    }

    const rawBuffer = await image.raw().toBuffer();
    const channels = 3;
    
    // Use the red box boundaries as the exact Y range for color boxes
    const boxTop = redBox.y;
    const boxBottom = redBox.y + redBox.height;
    const boxHeight = redBox.height;
    const scanY = Math.round(redBox.y + redBox.height / 2); // Middle Y for scanning
    
    console.log(`🔍 Scanning horizontally at Y=${scanY} for color boxes (Y range: ${boxTop}-${boxBottom})`);
    
    // Start scanning from right after the red box
    const scanStartX = Math.round(redBox.x + redBox.width + 5); // Small buffer after red box
    
    const colorBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      avgColor: { r: number; g: number; b: number };
    }> = [];
    
    let inColorBox = false;
    let colorBoxStart = 0;
    let consecutiveWhitePixels = 0;
    const minimumWhiteGap = 8; // Require at least 8 consecutive white pixels to end a box (balanced for 4x larger image)
    
    for (let x = scanStartX; x < width; x++) {
      const pixelIndex = (scanY * width + x) * channels;
      if (pixelIndex + 2 < rawBuffer.length) {
        const color = {
          r: rawBuffer[pixelIndex],
          g: rawBuffer[pixelIndex + 1],
          b: rawBuffer[pixelIndex + 2]
        };
        
        // Check if this pixel is white/near-white (background between boxes)
        const isWhite = this.isWhiteOrNearWhite(color);
        
        if (isWhite) {
          consecutiveWhitePixels++;
        } else {
          consecutiveWhitePixels = 0; // Reset counter on non-white pixel
        }
        
        if (!isWhite && !inColorBox) {
          // Transitioning from white to color - starting a new color box
          inColorBox = true;
          colorBoxStart = x;
          consecutiveWhitePixels = 0;
          console.log(`📦 Starting color box at X=${x}`);
        } else if (consecutiveWhitePixels >= minimumWhiteGap && inColorBox) {
          // Transitioning from color to sustained white - ending current color box
          const colorBoxWidth = (x - minimumWhiteGap + 1) - colorBoxStart; // Adjust for white pixels
          if (colorBoxWidth > 8) { // Minimum width for valid color box
            // Sample colors across the entire Y range of this box region
            const avgColor = await this.sampleColorBoxRegion(
              rawBuffer, width, channels, colorBoxStart, x - minimumWhiteGap + 1, boxTop, boxBottom
            );
            
            colorBoxes.push({
              x: colorBoxStart,
              y: boxTop,
              width: colorBoxWidth,
              height: boxHeight,
              avgColor
            });
            
            console.log(`📦 Completed color box at (${colorBoxStart}, ${boxTop}) size: ${colorBoxWidth}x${boxHeight}`);
          }
          inColorBox = false;
          consecutiveWhitePixels = 0;
        }
      }
    }
    
    // Handle case where last box extends to edge
    if (inColorBox) {
      const colorBoxWidth = width - colorBoxStart;
      if (colorBoxWidth > 8) {
        const avgColor = await this.sampleColorBoxRegion(
          rawBuffer, width, channels, colorBoxStart, width, boxTop, boxBottom
        );
        
        colorBoxes.push({
          x: colorBoxStart,
          y: boxTop,
          width: colorBoxWidth,
          height: boxHeight,
          avgColor
        });
        
        console.log(`📦 Completed final color box at (${colorBoxStart}, ${boxTop}) size: ${colorBoxWidth}x${boxHeight}`);
      }
    }
    
    // Post-process: merge nearby color boxes that are likely the same box split incorrectly
    // Temporarily disabled to check if original detection is correct
    // const mergedColorBoxes = this.mergeNearbyColorBoxes(colorBoxes);
    // console.log(`🔧 Merged ${colorBoxes.length} boxes into ${mergedColorBoxes.length} final boxes`);
    
    return colorBoxes;
  }

  /**
   * Check if a pixel is white or near-white (background between color boxes)
   */
  private isWhiteOrNearWhite(color: { r: number; g: number; b: number }): boolean {
    // More conservative white detection - only consider very bright pixels as white
    // This prevents light parts of color boxes from being mistaken for separators
    const brightness = (color.r + color.g + color.b) / 3;
    return brightness > 240; // Only very bright colors are considered white
  }

  /**
   * Merge nearby color boxes that are likely the same box split incorrectly
   */
  private mergeNearbyColorBoxes(colorBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    avgColor: { r: number; g: number; b: number };
  }>): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    avgColor: { r: number; g: number; b: number };
  }> {
    if (colorBoxes.length <= 1) return colorBoxes;
    
    const mergedBoxes = [];
    const maxGapToMerge = 5; // Maximum gap between boxes to consider merging (only very close boxes)
    
    // Sort boxes by x position
    const sortedBoxes = [...colorBoxes].sort((a, b) => a.x - b.x);
    
    let currentBox = sortedBoxes[0];
    
    for (let i = 1; i < sortedBoxes.length; i++) {
      const nextBox = sortedBoxes[i];
      const gap = nextBox.x - (currentBox.x + currentBox.width);
      
      console.log(`🔍 Gap between box at X=${currentBox.x} (width: ${currentBox.width}) and X=${nextBox.x}: ${gap}px`);
      
      if (gap >= 0 && gap <= maxGapToMerge) {
        // Merge these boxes
        const mergedWidth = (nextBox.x + nextBox.width) - currentBox.x;
        const mergedAvgColor = this.averageColors([currentBox.avgColor, nextBox.avgColor]);
        
        console.log(`🔧 Merging boxes at X=${currentBox.x} and X=${nextBox.x} (gap: ${gap}px)`);
        
        currentBox = {
          x: currentBox.x,
          y: currentBox.y,
          width: mergedWidth,
          height: currentBox.height,
          avgColor: mergedAvgColor
        };
      } else {
        // Gap is too large, keep current box and move to next
        console.log(`➡️  Gap too large (${gap}px), keeping separate boxes`);
        mergedBoxes.push(currentBox);
        currentBox = nextBox;
      }
    }
    
    // Add the last box
    mergedBoxes.push(currentBox);
    
    return mergedBoxes;
  }

  /**
   * Average two colors together
   */
  private averageColors(colors: Array<{ r: number; g: number; b: number }>): { r: number; g: number; b: number } {
    if (colors.length === 0) return { r: 0, g: 0, b: 0 };
    
    const sum = colors.reduce((acc, color) => ({
      r: acc.r + color.r,
      g: acc.g + color.g,
      b: acc.b + color.b
    }), { r: 0, g: 0, b: 0 });
    
    return {
      r: Math.round(sum.r / colors.length),
      g: Math.round(sum.g / colors.length),
      b: Math.round(sum.b / colors.length)
    };
  }

  /**
   * Sample colors across the entire Y range of a color box region
   * This handles the fact that color boxes contain text and aren't uniform colors
   */
  private async sampleColorBoxRegion(
    rawBuffer: Buffer, 
    width: number, 
    channels: number, 
    startX: number, 
    endX: number, 
    startY: number, 
    endY: number
  ): Promise<{ r: number; g: number; b: number }> {
    const colorSamples: Array<{ r: number; g: number; b: number }> = [];
    
    // Sample every few pixels across the entire box region
    const stepX = Math.max(1, Math.floor((endX - startX) / 10)); // Sample ~10 points horizontally
    const stepY = Math.max(1, Math.floor((endY - startY) / 5));  // Sample ~5 points vertically
    
    for (let y = startY; y < endY; y += stepY) {
      for (let x = startX; x < endX; x += stepX) {
        const pixelIndex = (y * width + x) * channels;
        if (pixelIndex + 2 < rawBuffer.length) {
          const color = {
            r: rawBuffer[pixelIndex],
            g: rawBuffer[pixelIndex + 1],
            b: rawBuffer[pixelIndex + 2]
          };
          
          // Only include non-white pixels in our color sample
          if (!this.isWhiteOrNearWhite(color)) {
            colorSamples.push(color);
          }
        }
      }
    }
    
    if (colorSamples.length === 0) {
      // Fallback: if no non-white pixels found, sample the center
      const centerY = Math.round((startY + endY) / 2);
      const centerX = Math.round((startX + endX) / 2);
      const pixelIndex = (centerY * width + centerX) * channels;
      
      if (pixelIndex + 2 < rawBuffer.length) {
        return {
          r: rawBuffer[pixelIndex],
          g: rawBuffer[pixelIndex + 1],
          b: rawBuffer[pixelIndex + 2]
        };
      }
      
      return { r: 128, g: 128, b: 128 }; // Default gray
    }
    
    // Calculate average of all non-white color samples
    return this.calculateAverageColor(colorSamples);
  }

  /**
   * Fallback method using the old percentage-based approach
   */
  private async extractColorsWithFallback(imagePath: string): Promise<ReferenceColor[]> {
    console.log('🔄 Using fallback percentage-based detection...');
    
    const dimensions = await this.pdfProcessor.getImageDimensions(imagePath);
    
    // Use the old approach as fallback
    const colorBoxes = await this.detectColorBoxBoundaries(imagePath);
    console.log(`📦 Found ${colorBoxes.length} color boxes using fallback method`);

    const referenceColors: ReferenceColor[] = [];
    
    for (let i = 0; i < colorBoxes.length; i++) {
      const box = colorBoxes[i];
      console.log(`🎨 Processing fallback color box ${i + 1}/${colorBoxes.length} at (${Math.round(box.x)}, ${Math.round(box.y)})...`);
      
      try {
        const textBoundingBox: BoundingBox = {
          x: box.x, // Use original box position
          y: box.y + box.height,
          width: box.width, // Use original box width to avoid overlap
          height: Math.round(dimensions.height * 0.15)
        };

        const colorInfo = await this.extractColorInfoEnhanced(imagePath, textBoundingBox, box.avgColor);
        if (colorInfo) {
          referenceColors.push(colorInfo);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to extract color info from fallback box ${i + 1}:`, error);
      }
    }

    return referenceColors;
  }

  /**
   * Detect individual color box boundaries using white space detection
   */
  private async detectColorBoxBoundaries(imagePath: string): Promise<Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    avgColor: { r: number; g: number; b: number };
  }>> {
    const image = sharp(imagePath);
    const { width, height } = await image.metadata();
    
    if (!width || !height) {
      throw new Error('Unable to get image dimensions');
    }

    const rawBuffer = await image.raw().toBuffer();
    const channels = 3;
    
    // Step 1: Find the color box row by scanning multiple Y positions
    const colorBoxY = await this.findColorBoxRow(rawBuffer, width, height, channels);
    console.log(`📍 Color boxes detected at Y=${colorBoxY}`);
    
    // Step 2: Find vertical boundaries of color boxes
    const { boxTop, boxBottom } = await this.findVerticalBoundaries(rawBuffer, width, height, channels, colorBoxY);
    console.log(`📏 Color box vertical boundaries: top=${boxTop}, bottom=${boxBottom}, height=${boxBottom - boxTop}`);
    
    // Step 3: Find horizontal boundaries (white space gaps) between boxes
    const horizontalBoundaries = await this.findHorizontalBoundaries(rawBuffer, width, height, channels, colorBoxY);
    console.log(`🔍 Found ${horizontalBoundaries.length - 1} horizontal boundaries between boxes`);
    
    // Step 4: Create individual box regions
    const colorBoxes = [];
    for (let i = 0; i < horizontalBoundaries.length - 1; i++) {
      const boxStartX = horizontalBoundaries[i];
      const boxEndX = horizontalBoundaries[i + 1];
      const boxWidth = boxEndX - boxStartX;
      
             // Skip very narrow regions (likely noise)
       if (boxWidth < 8) continue; // Reduced from 20 to 8 to catch smaller boxes
      
      // Extract average color from the box region
      const avgColor = await this.extractAverageColorFromRegion(
        rawBuffer, width, channels, boxStartX, boxEndX, boxTop, boxBottom
      );
      
      colorBoxes.push({
        x: boxStartX,
        y: boxTop,
        width: boxWidth,
        height: boxBottom - boxTop,
        avgColor
      });
    }
    
    return colorBoxes;
  }

  /**
   * Find the Y position where color boxes are located
   */
  private async findColorBoxRow(rawBuffer: Buffer, width: number, height: number, channels: number): Promise<number> {
    const scanPositions = [0.10, 0.118, 0.15, 0.20, 0.25, 0.30].map(ratio => Math.round(height * ratio));
    
    for (const scanY of scanPositions) {
      let colorPixelCount = 0;
      let totalPixelCount = 0;
      
      for (let x = 0; x < width; x += 5) {
        const pixelIndex = (scanY * width + x) * channels;
        if (pixelIndex + 2 < rawBuffer.length) {
          totalPixelCount++;
          const color = {
            r: rawBuffer[pixelIndex],
            g: rawBuffer[pixelIndex + 1],
            b: rawBuffer[pixelIndex + 2]
          };
          
          if (this.isColorBoxPixel(color)) {
            colorPixelCount++;
          }
        }
      }
      
      const colorRatio = colorPixelCount / totalPixelCount;
      if (colorRatio > 0.3) { // At least 30% color pixels indicates color box row
        return scanY;
      }
    }
    
    return Math.round(height * 0.118); // Fallback to default position
  }

  /**
   * Find vertical boundaries of color boxes
   */
  private async findVerticalBoundaries(rawBuffer: Buffer, width: number, height: number, channels: number, centerY: number): Promise<{
    boxTop: number;
    boxBottom: number;
  }> {
    let boxTop = centerY;
    let boxBottom = centerY;
    
    // Scan upward to find top boundary
    for (let y = centerY; y >= 0; y--) {
      let colorPixelCount = 0;
      let totalPixelCount = 0;
      
      for (let x = 0; x < width; x += 10) {
        const pixelIndex = (y * width + x) * channels;
        if (pixelIndex + 2 < rawBuffer.length) {
          totalPixelCount++;
          const color = {
            r: rawBuffer[pixelIndex],
            g: rawBuffer[pixelIndex + 1],
            b: rawBuffer[pixelIndex + 2]
          };
          
          if (this.isColorBoxPixel(color)) {
            colorPixelCount++;
          }
        }
      }
      
      const colorRatio = colorPixelCount / totalPixelCount;
      if (colorRatio > 0.2) {
        boxTop = y;
      } else {
        break;
      }
    }
    
    // Scan downward to find bottom boundary
    for (let y = centerY; y < height; y++) {
      let colorPixelCount = 0;
      let totalPixelCount = 0;
      
      for (let x = 0; x < width; x += 10) {
        const pixelIndex = (y * width + x) * channels;
        if (pixelIndex + 2 < rawBuffer.length) {
          totalPixelCount++;
          const color = {
            r: rawBuffer[pixelIndex],
            g: rawBuffer[pixelIndex + 1],
            b: rawBuffer[pixelIndex + 2]
          };
          
          if (this.isColorBoxPixel(color)) {
            colorPixelCount++;
          }
        }
      }
      
      const colorRatio = colorPixelCount / totalPixelCount;
      if (colorRatio > 0.2) {
        boxBottom = y;
      } else {
        break;
      }
    }
    
    return { boxTop, boxBottom };
  }

  /**
   * Find horizontal boundaries (white space gaps) between color boxes
   */
  private async findHorizontalBoundaries(rawBuffer: Buffer, width: number, height: number, channels: number, scanY: number): Promise<number[]> {
    const boundaries = [0]; // Start with left edge
    
    // Create a smoothed color intensity map
    const intensityMap: number[] = [];
    for (let x = 0; x < width; x++) {
      const pixelIndex = (scanY * width + x) * channels;
      if (pixelIndex + 2 < rawBuffer.length) {
        const color = {
          r: rawBuffer[pixelIndex],
          g: rawBuffer[pixelIndex + 1],
          b: rawBuffer[pixelIndex + 2]
        };
        
        const brightness = (color.r + color.g + color.b) / 3;
        intensityMap.push(brightness);
      } else {
        intensityMap.push(255); // White as default
      }
    }
    
    // Apply lighter smoothing to preserve individual boxes
    const smoothedMap: number[] = [];
    const windowSize = 2; // Reduced from 5 to 2 for better sensitivity
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let i = Math.max(0, x - windowSize); i <= Math.min(width - 1, x + windowSize); i++) {
        sum += intensityMap[i];
        count++;
      }
      smoothedMap.push(sum / count);
    }
    
    // Find boundaries using brightness transitions
    let inColorBox = false;
    let colorBoxStart = 0;
    
    for (let x = 0; x < width; x++) {
      const brightness = smoothedMap[x];
      const isColorPixel = brightness < 230; // More lenient threshold
      
      if (isColorPixel && !inColorBox) {
        // Starting a new color box
        inColorBox = true;
        colorBoxStart = x;
             } else if (!isColorPixel && inColorBox) {
         // Ending a color box
         const colorBoxWidth = x - colorBoxStart;
         if (colorBoxWidth > 10) { // Reduced minimum width to catch smaller boxes
           boundaries.push(colorBoxStart);
           boundaries.push(x);
         }
         inColorBox = false;
       }
    }
    
         // Handle case where last box extends to edge
     if (inColorBox) {
       const colorBoxWidth = width - colorBoxStart;
       if (colorBoxWidth > 10) { // Reduced minimum width to catch smaller boxes
         boundaries.push(colorBoxStart);
         boundaries.push(width);
       }
     }
    
    boundaries.push(width); // End with right edge
    
    // Remove duplicates and sort
    const uniqueBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);
    
    console.log(`🔍 Debug: Found boundaries at positions: ${uniqueBoundaries.join(', ')}`);
    
    return uniqueBoundaries;
  }

  /**
   * Check if a pixel is white space (background)
   */
  private isWhiteSpacePixel(color: { r: number; g: number; b: number }): boolean {
    const brightness = (color.r + color.g + color.b) / 3;
    return brightness > 230; // More lenient threshold for white or very light pixels
  }

  /**
   * Extract average color from a specific region
   */
  private async extractAverageColorFromRegion(
    rawBuffer: Buffer, 
    width: number, 
    channels: number, 
    startX: number, 
    endX: number, 
    startY: number, 
    endY: number
  ): Promise<{ r: number; g: number; b: number }> {
    const colorSamples: Array<{ r: number; g: number; b: number }> = [];
    
    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        const pixelIndex = (y * width + x) * channels;
        if (pixelIndex + 2 < rawBuffer.length) {
          const color = {
            r: rawBuffer[pixelIndex],
            g: rawBuffer[pixelIndex + 1],
            b: rawBuffer[pixelIndex + 2]
          };
          
          if (this.isColorBoxPixel(color)) {
            colorSamples.push(color);
          }
        }
      }
    }
    
    if (colorSamples.length === 0) {
      return { r: 128, g: 128, b: 128 }; // Default gray if no color found
    }
    
    return this.calculateAverageColor(colorSamples);
  }

  /**
   * Enhanced color region scanning (kept for compatibility)
   */
  private async scanForColorRegionsEnhanced(imagePath: string, scanY: number): Promise<ColorRegion[]> {
    // This method is kept for backward compatibility but not used in the new approach
    return [];
  }

  /**
   * Check if a pixel is likely part of a color box
   */
  private isColorBoxPixel(color: { r: number; g: number; b: number }): boolean {
    const brightness = (color.r + color.g + color.b) / 3;
    // More lenient threshold for color detection
    return brightness < 250 && brightness > 20; // Exclude pure white and pure black
  }

  /**
   * Check if two colors are similar
   */
  private isSimilarColor(color1: { r: number; g: number; b: number }, color2: { r: number; g: number; b: number }, threshold: number): boolean {
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db) < threshold;
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
   * Enhanced color information extraction with corrected positioning
   */
  private async extractColorInfoEnhanced(imagePath: string, boundingBox: BoundingBox, regionColor: { r: number; g: number; b: number }): Promise<ReferenceColor | null> {
    try {
      // Extract the region below the color box for OCR
      const boxBuffer = await this.pdfProcessor.extractRegion(imagePath, boundingBox);
      
      if (this.debugMode) {
        await this.saveDebugImage(boxBuffer, `color_box_${boundingBox.x}_${boundingBox.y}`);
      }
      
      // Try multiple OCR preprocessing approaches
      const ocrAttempts = await this.performMultipleOCRAttempts(boxBuffer);
      
      if (this.debugMode) {
        console.log(`OCR attempts for region at ${boundingBox.x}:`, ocrAttempts);
      }
      
      // Parse the best OCR result
      let bestColorInfo = null;
      for (const ocrResult of ocrAttempts) {
        const colorInfo = this.parseColorBoxTextEnhanced(ocrResult.lines);
        if (this.debugMode) {
          console.log(`📝 Parsed OCR result for position ${boundingBox.x}:`, colorInfo);
        }
        if (colorInfo && colorInfo.colorCode.length >= 2 && colorInfo.colorCode.match(/^[A-Z]\d+/)) {
          bestColorInfo = colorInfo;
          console.log(`✅ Found valid color code for position ${boundingBox.x}: ${colorInfo.colorCode}`);
          break;
        }
      }
      
      if (bestColorInfo) {
        return {
          ...bestColorInfo,
          rgb: regionColor,
          hex: PDFProcessor.rgbToHex(regionColor.r, regionColor.g, regionColor.b),
          boundingBox
        };
      } else {
        // Enhanced fallback - try to extract at least a color code pattern
        const allText = ocrAttempts.map(attempt => attempt.text).join(' ');
        const colorCodePatterns = [
          /([A-Z]\d{2,6})/g,         // Flexible: B22, B40002, E2011, etc.
          /([A-Z]\d+[A-Z]?)/g,       // Handle patterns like B200X
          /\b([A-Z]\d{2,})\b/g       // Word boundary version
        ];
        
        let colorCodeMatch = null;
        for (const pattern of colorCodePatterns) {
          const matches = allText.match(pattern);
          if (matches && matches.length > 0) {
            colorCodeMatch = matches;
            break;
          }
        }
        
        if (colorCodeMatch) {
          const cleanedCode = colorCodeMatch[0].replace(/[^\w]/g, '');
          // Also try to extract Pantone code from the text
          const pantoneMatch = allText.match(/(\d{1,2}-\d{4}\s*TCX)/);
          
          return {
            colorCode: cleanedCode,
            colorName: `Color ${cleanedCode}`,
            pantoneColor: pantoneMatch ? pantoneMatch[1] : 'Unknown',
            rgb: regionColor,
            hex: PDFProcessor.rgbToHex(regionColor.r, regionColor.g, regionColor.b),
            boundingBox
          };
        }
        
        // Final fallback
        const fallbackColorCode = this.generateFallbackColorCode(boundingBox.x, regionColor);
        return {
          colorCode: fallbackColorCode,
          colorName: `Color at ${boundingBox.x}`,
          pantoneColor: 'Unknown',
          rgb: regionColor,
          hex: PDFProcessor.rgbToHex(regionColor.r, regionColor.g, regionColor.b),
          boundingBox
        };
      }
      
    } catch (error) {
      console.warn('Failed to extract color info:', error);
      return null;
    }
  }

  /**
   * Perform multiple OCR attempts with different preprocessing
   */
  private async performMultipleOCRAttempts(boxBuffer: Buffer): Promise<Array<{ text: string; lines: string[] }>> {
    const attempts: Array<{ text: string; lines: string[] }> = [];
    
    try {
      // Attempt 1: Original image
      const originalResult = await Tesseract.recognize(boxBuffer, 'eng', {
        logger: this.debugMode ? console.log : undefined
      });
      attempts.push({
        text: originalResult.data.text.trim(),
        lines: originalResult.data.text.split('\n').filter(line => line.trim().length > 0)
      });
      
      // Attempt 2: High contrast
      const contrastBuffer = await sharp(boxBuffer)
        .greyscale()
        .normalise()
        .threshold(128)
        .png()
        .toBuffer();
        
      const contrastResult = await Tesseract.recognize(contrastBuffer, 'eng', {
        logger: this.debugMode ? console.log : undefined
      });
      attempts.push({
        text: contrastResult.data.text.trim(),
        lines: contrastResult.data.text.split('\n').filter(line => line.trim().length > 0)
      });
      
      // Attempt 3: Large scaled version for better OCR
      const scaledBuffer = await sharp(boxBuffer)
        .resize({ width: 1600, height: 1200, fit: 'fill' })
        .sharpen()
        .png()
        .toBuffer();
        
      const scaledResult = await Tesseract.recognize(scaledBuffer, 'eng', {
        logger: this.debugMode ? console.log : undefined
      });
      attempts.push({
        text: scaledResult.data.text.trim(),
        lines: scaledResult.data.text.split('\n').filter(line => line.trim().length > 0)
      });
      
      // Attempt 4: Extra large scaled version with enhanced preprocessing
      const extraLargeBuffer = await sharp(boxBuffer)
        .resize({ width: 2400, height: 1800, fit: 'fill' })
        .greyscale()
        .normalise()
        .sharpen({ sigma: 1.5 })
        .png()
        .toBuffer();
        
      const extraLargeResult = await Tesseract.recognize(extraLargeBuffer, 'eng', {
        logger: this.debugMode ? console.log : undefined
      });
      attempts.push({
        text: extraLargeResult.data.text.trim(),
        lines: extraLargeResult.data.text.split('\n').filter(line => line.trim().length > 0)
      });
      
      // Attempt 5: Maximum resolution with advanced preprocessing
      const maxResBuffer = await sharp(boxBuffer)
        .resize({ width: 3200, height: 2400, fit: 'fill' })
        .greyscale()
        .normalise()
        .modulate({ brightness: 1.2 })
        .linear(1.5, 0) // Increase contrast
        .sharpen({ sigma: 2.0 })
        .png()
        .toBuffer();
        
      const maxResResult = await Tesseract.recognize(maxResBuffer, 'eng', {
        logger: this.debugMode ? console.log : undefined
      });
      attempts.push({
        text: maxResResult.data.text.trim(),
        lines: maxResResult.data.text.split('\n').filter(line => line.trim().length > 0)
      });
      
    } catch (error) {
      console.warn('OCR attempt failed:', error);
    }
    
    return attempts;
  }

  /**
   * Enhanced text parsing with focus on Pantone codes
   */
  private parseColorBoxTextEnhanced(lines: string[]): { colorCode: string; colorName: string; pantoneColor: string } | null {
    let colorCode = '';
    let colorName = '';
    let pantoneColor = '';
    
    // Combine all lines for pattern matching
    const allText = lines.join(' ');
    
    // Enhanced color code patterns - more flexible to handle various formats
    const colorCodePatterns = [
      /([A-Z]\d{2,6})/g,         // Flexible: B22, B40002, E2011, etc.
      /([A-Z]\d+[A-Z]?)/g,       // Handle patterns like B200X
      /\b([A-Z]\d{2,})\b/g,      // Word boundary version (minimum 2 digits)
      /([A-Z]\d+)[^\w]/g,        // Handle codes followed by punctuation
      /^([A-Z]\d+)/g             // Handle codes at start of line
    ];
    
    for (const pattern of colorCodePatterns) {
      const matches = allText.match(pattern);
      if (matches && matches.length > 0) {
        colorCode = matches[0];
        break;
      }
    }
    
    // Enhanced Pantone color extraction
    const pantonePatterns = [
      /(\d{2}-\d{4}\s*TCX)/g,    // Standard Pantone format
      /(\d{1,2}-\d{4}\s*TCX)/g,  // Allow single digit prefix
      /(\d{2}-\d{3,5}\s*TCX)/g   // Flexible digit count
    ];
    
    for (const pattern of pantonePatterns) {
      const matches = allText.match(pattern);
      if (matches && matches.length > 0) {
        pantoneColor = matches[0];
        break;
      }
    }
    
    // Extract color name (avoid lines with codes or TCX)
    for (const line of lines) {
      const cleanLine = line.trim();
      if (cleanLine.length > 2 && 
          !cleanLine.includes('TCX') && 
          !cleanLine.match(/^[A-Z]\d+$/) &&
          !cleanLine.match(/^\d/) &&
          !cleanLine.match(/^[_\-\s]+$/)) {
        colorName = cleanLine;
        break;
      }
    }
    
    // Clean up the color code (remove trailing punctuation)
    colorCode = colorCode.replace(/[^\w]/g, '');
    
    if (colorCode.length >= 2 && colorCode.match(/^[A-Z]\d+/)) {
      return {
        colorCode,
        colorName: colorName || 'Unknown',
        pantoneColor: pantoneColor || 'Unknown'
      };
    }
    
    return null;
  }

  /**
   * Generate a fallback color code based on position and color
   */
  private generateFallbackColorCode(x: number, color: { r: number; g: number; b: number }): string {
    const section = Math.floor(x / 200) + 1;
    const colorHash = (color.r + color.g + color.b) % 1000;
    return `C${section}${colorHash.toString().padStart(3, '0')}`;
  }

  /**
   * Save debug image
   */
  private async saveDebugImage(buffer: Buffer, name: string): Promise<void> {
    const outputPath = `output/debug_${name}.png`;
    await sharp(buffer).png().toFile(outputPath);
    console.log(`📸 Debug image saved: ${outputPath}`);
  }
} 