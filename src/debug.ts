import path from 'path';
import fs from 'fs';
import { PDFProcessor } from './pdf-processor';
import { DebugAnalyzer } from './debug-analyzer';

async function debugPDF() {
  console.log('🔍 Starting PDF Debug Analysis');
  console.log('==============================\n');

  // Configuration
  const pdfPath = path.join(__dirname, '..', 'SS27_OUTDOOR_MEN_TRIALS.pdf');
  const outputDir = path.join(__dirname, '..', 'output');

  // Check if PDF exists
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF file not found: ${pdfPath}`);
    process.exit(1);
  }

  try {
    // Initialize PDF processor
    console.log('📄 Initializing PDF processor...');
    const pdfProcessor = new PDFProcessor(pdfPath, outputDir);
    
    // Convert PDF to images
    console.log('🖼️  Converting PDF to images...');
    const imagePaths = await pdfProcessor.convertPDFToImages();
    
    if (imagePaths.length === 0) {
      console.error('❌ No images were generated from the PDF');
      process.exit(1);
    }

    // Focus on the first page
    const firstPagePath = imagePaths[0];
    console.log(`📋 Processing first page: ${firstPagePath}`);

    // Initialize debug analyzer
    console.log('🔍 Initializing debug analyzer...');
    const debugAnalyzer = new DebugAnalyzer(pdfProcessor, outputDir);

    // Perform comprehensive analysis
    await debugAnalyzer.analyzePDF(firstPagePath);

    console.log('\n📊 DEBUG ANALYSIS COMPLETE');
    console.log('===========================');
    console.log('✅ Analysis files created in output directory:');
    console.log('• analysis_top_*.png - Different top section extractions');
    console.log('• color_distribution_analysis.json - Color distribution data');
    console.log('• rectangular_regions_analysis.json - Detected rectangular regions');
    console.log('• high_contrast_text_analysis.png - Text detection visualization');
    console.log('\n🔄 NEXT STEPS:');
    console.log('1. Review the analysis files to understand the PDF structure');
    console.log('2. Check which top section percentage contains the reference colors');
    console.log('3. Examine the rectangular regions to see if any match expected color boxes');
    console.log('4. Use the findings to adjust the color detection parameters');

  } catch (error) {
    console.error('❌ Error during debug analysis:', error);
    process.exit(1);
  }
}

// Run the debug function
if (require.main === module) {
  debugPDF().catch(console.error);
}

export { debugPDF }; 