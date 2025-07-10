import path from 'path';
import fs from 'fs';
import { PDFProcessor } from './pdf-processor';
import { ReferenceColorExtractor } from './reference-color-extractor';
import { SwatchExtractor } from './swatch-extractor';
import { ColorValidator } from './validate-and-correct';
import { ColorMatcher } from './color-matcher';
import { CSVGenerator } from './csv-generator';
import { ReferenceColor, SwatchGroup } from './types';

async function main() {
  console.log('🚀 Starting PDF Color Analysis Tool');
  console.log('==================================\n');

  // Get PDF path from command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('❌ Please provide a PDF file path');
    console.log('\n📋 Usage:');
    console.log('  npm start <path-to-pdf-file>');
    console.log('  or');
    console.log('  node dist/index.js <path-to-pdf-file>');
    console.log('\n📋 Example:');
    console.log('  npm start ./SS27_OUTDOOR_MEN_TRIALS.pdf');
    console.log('  npm start /Users/username/Documents/catalog.pdf');
    process.exit(1);
  }

  const pdfPath = path.resolve(args[0]); // Convert to absolute path
  
  // Configuration
  const outputDir = path.join(__dirname, '..', 'output');
  const debugMode = true;
  const highDPI = 1200; // Very high DPI for maximum OCR text recognition
  const processReferences = true; // Set to false to skip reference color processing
  const processSwatches = true; // Set to false to skip swatch processing
  const processColorMatching = true; // Set to false to skip color matching
  const generateCSV = true; // Set to false to skip CSV generation

  console.log(`📄 Processing PDF: ${pdfPath}`);

  // Check if PDF exists
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF file not found: ${pdfPath}`);
    console.log('Please ensure the PDF file exists and the path is correct.');
    process.exit(1);
  }

  try {
    // Initialize PDF processor
    console.log('📄 Initializing PDF processor...');
    const pdfProcessor = new PDFProcessor(pdfPath, outputDir, highDPI);
    
    // Clean output directory selectively based on processing type
    pdfProcessor.cleanOutputDirectory(processReferences, processSwatches);
    
    // Convert PDF to images
    console.log('🖼️  Converting PDF to images...');
    const imagePaths = await pdfProcessor.convertPDFToImages();
    
    if (imagePaths.length === 0) {
      console.error('❌ No images were generated from the PDF');
      process.exit(1);
    }

    // Focus on the first page for processing
    const firstPagePath = imagePaths[0];
    console.log(`📋 Processing first page: ${firstPagePath}`);

    let extractedColors: ReferenceColor[] = [];
    let finalColors: ReferenceColor[] = [];
    let redAnchorBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
    let validationResult: any = null;

    if (processReferences) {
      // Initialize reference color extractor
      console.log('🎨 Initializing reference color extractor...');
      const referenceExtractor = new ReferenceColorExtractor(pdfProcessor, debugMode);

      // Extract reference colors and get red anchor boxes
      console.log('🔍 Extracting reference colors...');
      const extractionResult = await referenceExtractor.extractReferenceColorsWithRedBoxes(firstPagePath);
      extractedColors = extractionResult.referenceColors;
      redAnchorBoxes = extractionResult.redAnchorBoxes;

      // Validate and correct colors automatically
      console.log('\n🔧 Validating and correcting extracted colors...');
      validationResult = ColorValidator.validateAndCorrect(extractedColors);
      
      console.log(validationResult.summary);
      
      finalColors = extractedColors;
      
      if (!validationResult.isValid) {
        console.log('🛠️  Applying corrections automatically...');
        finalColors = ColorValidator.applyCorrections(extractedColors, validationResult.corrections);
        console.log(`✅ Applied ${validationResult.corrections.length} corrections`);
      }
    } else {
      // When not processing references, try to load existing reference colors
      console.log('⏭️  Skipping reference color processing...');
      const existingResultsPath = path.join(outputDir, 'reference_colors.json');
      
      if (fs.existsSync(existingResultsPath)) {
        console.log('📂 Loading existing reference colors from previous run...');
        try {
          const existingResults = JSON.parse(fs.readFileSync(existingResultsPath, 'utf8'));
          
          if (existingResults.referenceColors && existingResults.referenceColors.length > 0) {
            finalColors = existingResults.referenceColors;
            
            // Generate approximate red anchor boxes based on existing reference colors
            redAnchorBoxes = existingResults.referenceColors.map((color: ReferenceColor) => ({
              x: color.boundingBox.x,
              y: color.boundingBox.y,
              width: color.boundingBox.width,
              height: color.boundingBox.height
            }));
            console.log(`✅ Loaded ${finalColors.length} reference colors and ${redAnchorBoxes.length} red anchor boxes`);
          } else {
            console.warn('⚠️  No reference colors found in existing results, using default positioning');
            redAnchorBoxes = [
              { x: 42, y: 220, width: 150, height: 80 },
              { x: 234, y: 220, width: 150, height: 80 },
              { x: 428, y: 220, width: 150, height: 80 }
            ];
          }
        } catch (error) {
          console.warn('⚠️  Failed to load existing results, using default positioning');
          redAnchorBoxes = [
            { x: 42, y: 220, width: 150, height: 80 },
            { x: 234, y: 220, width: 150, height: 80 },
            { x: 428, y: 220, width: 150, height: 80 }
          ];
        }
      } else {
        console.warn('⚠️  No existing reference colors found, using default positioning for swatches');
        redAnchorBoxes = [
          { x: 42, y: 220, width: 150, height: 80 },
          { x: 234, y: 220, width: 150, height: 80 },
          { x: 428, y: 220, width: 150, height: 80 }
        ];
      }
    }

    let extractedSwatches: SwatchGroup[] = [];

    if (processSwatches) {
      // Extract swatches
      console.log('\n🧩 Extracting swatches...');
      const swatchExtractor = new SwatchExtractor(pdfProcessor, debugMode);
      extractedSwatches = await swatchExtractor.extractSwatches(firstPagePath, redAnchorBoxes);
    } else {
      // When not processing swatches, try to load existing swatches
      console.log('⏭️  Skipping swatch processing...');
      const existingSwatchesPath = path.join(outputDir, 'swatches.json');
      
      if (fs.existsSync(existingSwatchesPath)) {
        console.log('📂 Loading existing swatches from previous run...');
        try {
          const existingSwatches = JSON.parse(fs.readFileSync(existingSwatchesPath, 'utf8'));
          
          if (existingSwatches.swatches && existingSwatches.swatches.length > 0) {
            extractedSwatches = existingSwatches.swatches;
            console.log(`✅ Loaded ${extractedSwatches.length} swatches`);
          } else {
            console.warn('⚠️  No swatches found in existing results');
          }
        } catch (error) {
          console.warn('⚠️  Failed to load existing swatches');
        }
      } else {
        console.warn('⚠️  No existing swatches found');
      }
    }

    // Color matching processing
    let colorMatchingResult: any = null;
    
    if (processColorMatching && finalColors.length > 0 && extractedSwatches.length > 0) {
      console.log('\n🎯 Processing color matching...');
      const colorMatcher = new ColorMatcher(finalColors, 150); // Max distance of 150 for color matching
      colorMatchingResult = colorMatcher.matchSwatchesWithReferences(extractedSwatches);
      
      // Print detailed results
      colorMatcher.printMatchingResults(colorMatchingResult);
    } else if (processColorMatching) {
      if (finalColors.length === 0) {
        console.log('⚠️  Cannot perform color matching: No reference colors available');
      }
      if (extractedSwatches.length === 0) {
        console.log('⚠️  Cannot perform color matching: No swatches available');
      }
    } else {
      console.log('⏭️  Skipping color matching processing...');
    }

    // Display final results
    console.log('\n📊 FINAL EXTRACTION RESULTS');
    console.log('============================');
    
    if (processReferences && finalColors.length > 0) {
      console.log(`✅ Successfully extracted and validated ${finalColors.length} reference colors:\n`);
      
      finalColors.forEach((color: ReferenceColor, index: number) => {
        const isCorreted = validationResult && validationResult.corrections.some((c: any) => c.originalIndex === index);
        const prefix = isCorreted ? '🔧' : '  ';
        
        console.log(`${prefix} ${index + 1}. ${color.colorCode} - ${color.colorName}`);
        console.log(`     Pantone: ${color.pantoneColor}`);
        console.log(`     RGB: rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`);
        console.log(`     Hex: ${color.hex}`);
        console.log(`     Position: (${Math.round(color.boundingBox.x)}, ${Math.round(color.boundingBox.y)})`);
        console.log('');
      });
    } else if (processReferences) {
      console.log('⚠️  No reference colors were extracted');
    } else {
      console.log('⏭️  Reference color processing was skipped');
    }

    // Display swatch results
    console.log('\n🧩 SWATCH EXTRACTION RESULTS');
    console.log('============================');
    
    if (extractedSwatches.length > 0) {
      console.log(`✅ Successfully extracted ${extractedSwatches.length} swatches:\n`);
      
      extractedSwatches.forEach((swatch: SwatchGroup, index: number) => {
        console.log(`  ${index + 1}. ${swatch.styleNumber} - ${swatch.styleName}`);
        console.log(`     Colors: ${swatch.colors.length}`);
        console.log(`     Position: (${Math.round(swatch.boundingBox.x)}, ${Math.round(swatch.boundingBox.y)})`);
        console.log(`     Size: ${Math.round(swatch.boundingBox.width)}x${Math.round(swatch.boundingBox.height)}`);
        console.log('');
      });
    } else {
      console.log('⚠️  No swatches were extracted');
    }

    // Save results to JSON files
    
    // Save swatches if they were processed
    if (processSwatches) {
      const swatchesOutputPath = path.join(outputDir, 'swatches.json');
      const swatchesData = {
        timestamp: new Date().toISOString(),
        totalSwatches: extractedSwatches.length,
        extractionMethod: 'Simplified Row Detection + Horizontal Scanning + OCR',
        swatches: extractedSwatches
      };
      fs.writeFileSync(swatchesOutputPath, JSON.stringify(swatchesData, null, 2));
      console.log(`💾 Swatches saved to: ${swatchesOutputPath}`);
    }
    
    // Save reference colors if they were processed
    if (processReferences) {
      const rawResults = {
        timestamp: new Date().toISOString(),
        totalColors: extractedColors.length,
        totalSwatches: extractedSwatches.length,
        extractionMethod: 'Enhanced OCR',
        referenceColors: extractedColors,
        swatches: extractedSwatches
      };
      
      const finalResults = {
        timestamp: new Date().toISOString(),
        totalColors: finalColors.length,
        totalSwatches: extractedSwatches.length,
        extractionMethod: 'Enhanced OCR + Validation',
        validationApplied: validationResult ? !validationResult.isValid : false,
        correctionsApplied: validationResult ? validationResult.corrections.length : 0,
        referenceColors: finalColors,
        swatches: extractedSwatches
      };

      // Save both raw and corrected results
      const rawOutputPath = path.join(outputDir, 'reference_colors_raw.json');
      const finalOutputPath = path.join(outputDir, 'reference_colors.json');
      
      fs.writeFileSync(rawOutputPath, JSON.stringify(rawResults, null, 2));
      fs.writeFileSync(finalOutputPath, JSON.stringify(finalResults, null, 2));
      
      console.log(`💾 Raw results saved to: ${rawOutputPath}`);
      console.log(`💾 Final results saved to: ${finalOutputPath}`);
    }

    // Save color matching results if they were processed
    if (processColorMatching && colorMatchingResult) {
      const colorMatchingOutputPath = path.join(outputDir, 'color_matches.json');
      fs.writeFileSync(colorMatchingOutputPath, JSON.stringify(colorMatchingResult, null, 2));
      console.log(`💾 Color matching results saved to: ${colorMatchingOutputPath}`);
    }

    // Generate CSV files if requested
    if (generateCSV) {
      console.log('\n📊 GENERATING CSV FILES');
      console.log('======================');
      
      const csvGenerator = new CSVGenerator(outputDir);
      
      try {
        // Generate the basic CSV with style numbers and color codes
        await csvGenerator.generateStyleColorCSV();
        console.log('');
        
        // Generate the detailed CSV with additional information
        await csvGenerator.generateDetailedCSV();
        console.log('');
        
        console.log('✅ CSV generation complete!');
      } catch (error) {
        console.error('❌ Error generating CSV files:', error);
        console.log('⚠️  Make sure color_matches.json exists and is properly formatted');
      }
    }

    // Provide next steps
    console.log('\n🔄 NEXT STEPS');
    console.log('=============');
    
    if (processReferences && processSwatches && processColorMatching && generateCSV) {
      console.log('1. ✅ Reference color extraction complete with validation');
      console.log('2. ✅ Swatch extraction complete');
      console.log('3. ✅ Color matching complete');
      console.log('4. ✅ CSV files generated');
      console.log('5. 📋 Review the color_matches.json file for matched colors');
      console.log('6. 📊 Review the CSV files for style-color mappings');
      console.log('7. 🖼️  Check the debug images in the output folder if needed');
      console.log('8. 🎨 All processing steps complete!');
    } else {
      const steps = [];
      
      if (processReferences) {
        steps.push('✅ Reference color extraction complete with validation');
      } else {
        steps.push('⏭️  Reference color extraction was skipped');
      }
      
      if (processSwatches) {
        steps.push('✅ Swatch extraction complete');
      } else {
        steps.push('⏭️  Swatch extraction was skipped');
      }
      
      if (processColorMatching && colorMatchingResult) {
        steps.push('✅ Color matching complete');
      } else if (processColorMatching) {
        steps.push('⚠️  Color matching attempted but failed (missing data)');
      } else {
        steps.push('⏭️  Color matching was skipped');
      }
      
      if (generateCSV) {
        steps.push('✅ CSV files generated');
      } else {
        steps.push('⏭️  CSV generation was skipped');
      }
      
      steps.forEach((step, index) => {
        console.log(`${index + 1}. ${step}`);
      });
      
      console.log(`${steps.length + 1}. 🧩 Review the JSON files for results`);
      console.log(`${steps.length + 2}. 🖼️  Check the debug images in the output folder if needed`);
      console.log(`${steps.length + 3}. 💡 Adjust processing flags to enable/disable specific steps`);
    }

  } catch (error) {
    console.error('❌ Error during processing:', error);
    process.exit(1);
  }
}

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}

export { main }; 