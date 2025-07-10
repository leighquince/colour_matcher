# PDF Color Analysis Tool

A sophisticated TypeScript-based tool for extracting, analyzing, and matching colors from PDF documents. This tool uses advanced OCR technology and computer vision to identify color swatches, extract style information, and match colors against reference palettes.

## 🎯 Features

- **PDF Color Extraction**: Automatically extracts reference colors from PDF documents
- **Swatch Detection**: Identifies and extracts color swatches with associated text/style information
- **OCR Integration**: Uses Tesseract.js for accurate text recognition from swatch labels
- **Color Matching**: Matches extracted colors against reference palettes using Euclidean distance
- **CSV Export**: Generates clean CSV files for data analysis and integration
- **Debug Mode**: Comprehensive debugging with visual output for troubleshooting
- **Configurable Processing**: Boolean flags to control which processing steps to run
- **High-Quality Output**: Supports high-DPI processing for maximum accuracy

## 🔧 Prerequisites

- **Node.js** (v16 or higher)
- **npm** (v7 or higher)
- **TypeScript** (installed globally or via npm)

## 📦 Installation

1. **Clone or download the repository**

```bash
git clone https://github.com/leighquince/colour_matcher.git
cd colour_matcher
```

2. **Install dependencies**

```bash
npm install
```

3. **Build the project**

```bash
npm run build
```

## 🚀 Usage

### Basic Usage

```bash
npm start <path-to-pdf-file>
```

### Examples

```bash
# Process a PDF in the current directory
npm start ./catalog.pdf

# Process a PDF with absolute path
npm start /Users/username/Documents/color-catalog.pdf

# Process a PDF with relative path
npm start ../documents/fabric-swatches.pdf
```

### Alternative Usage

```bash
# Using Node.js directly
node dist/index.js <path-to-pdf-file>

# Development mode (with TypeScript compilation)
npm run dev <path-to-pdf-file>
```

## 📊 Output Files

The tool generates several output files in the `output/` directory:

### Generated Files

1. **`swatches.json`** - Complete swatch data with colors and OCR text
2. **`reference_colors.json`** - Extracted reference color palette
3. **`color_matches.json`** - Detailed color matching results with confidence scores
4. **`style_color_mapping.csv`** - Simple CSV with style numbers and color codes
5. **`detailed_style_color_mapping.csv`** - Comprehensive CSV with all color data

### Debug Files (when debug mode enabled)

- **`page.1.png`** - High-resolution PDF page image
- **`debug_red_anchor_boxes.png`** - Visual reference color detection
- **`debug_color_box_*.png`** - Individual color box extractions
- **`swatch_row*_*.png`** - Individual swatch extractions

## ⚙️ Configuration

You can modify processing behavior by editing the configuration flags in `src/index.ts`:

```typescript
const processReferences = true;     // Extract reference colors from PDF
const processSwatches = true;       // Extract swatches with OCR
const processColorMatching = true;  // Match colors against references
const generateCSV = true;           // Generate CSV output files
const debugMode = true;             // Enable debug output and images
```

## 📋 CSV Output Format

### Simple Format (`style_color_mapping.csv`)

```csv
Style Number,Color Code
123456,C10001
123456,C20002
789012,C30003
789012,C10001
345678,C40004
```

### Detailed Format (`detailed_style_color_mapping.csv`)

```csv
Style Number,Style Name,Color Code,Color Name,Pantone Color,RGB Hex,Confidence %
123456,PREMIUM T-SHIRT,C10001,Classic Black,19-4007 TCX,#1c1c1c,98.5
123456,PREMIUM T-SHIRT,C20002,Ocean Blue,19-4052 TCX,#2b4c8c,95.2
789012,COTTON POLO SHIRT,C30003,Forest Green,18-5845 TCX,#3e5d2f,92.8
789012,COTTON POLO SHIRT,C10001,Classic Black,19-4007 TCX,#1c1c1c,96.1
345678,CASUAL HOODIE,C40004,Sunset Orange,16-1253 TCX,#ff6b35,89.7
```

## 🎨 Color Matching Algorithm

The tool uses several sophisticated techniques for accurate color matching:

- **Euclidean Distance Calculation**: RGB color space distance measurement
- **Configurable Thresholds**: Adjustable maximum distance for matches
- **Confidence Scoring**: Percentage-based confidence for each match
- **Comprehensive Statistics**: Detailed matching results and analytics

## 🔍 OCR Processing

The text recognition system includes:

- **High-DPI Processing**: 1200 DPI for maximum text clarity
- **Smart Text Parsing**: Automatically extracts style numbers and names
- **6-Character Style Numbers**: Standardized style number format
- **Multi-line Text Support**: Handles complex swatch layouts

## 🛠️ Development

### Available Scripts

```bash
npm run build          # Compile TypeScript to JavaScript
npm run dev           # Run in development mode with ts-node
npm start             # Run the compiled application
npm run analyze       # Run PDF analysis tools
npm run debug         # Run debug tools
```

### Project Structure

```
colour_matcher/
├── src/
│   ├── index.ts                    # Main application entry point
│   ├── pdf-processor.ts           # PDF to image conversion
│   ├── reference-color-extractor.ts # Reference color extraction
│   ├── swatch-extractor.ts        # Swatch detection and OCR
│   ├── color-matcher.ts           # Color matching algorithm
│   ├── csv-generator.ts           # CSV file generation
│   ├── validate-and-correct.ts    # Color validation tools
│   └── types.ts                   # TypeScript type definitions
├── output/                        # Generated files (ignored by git)
├── package.json                   # Project dependencies
└── tsconfig.json                  # TypeScript configuration
```

## 🚨 Troubleshooting

### Common Issues

**1. "PDF file not found" Error**

- Ensure the PDF path is correct
- Use absolute paths if relative paths don't work
- Check file permissions

**2. OCR Recognition Issues**

- Ensure PDF has sufficient resolution
- Check that text in PDF is clear and readable
- Increase DPI setting in configuration

**3. Color Matching Problems**

- Verify reference colors are properly extracted
- Adjust color distance threshold in ColorMatcher
- Check debug images for visual confirmation

**4. Build Errors**

- Ensure all dependencies are installed: `npm install`
- Verify Node.js version: `node --version`
- Clear npm cache: `npm cache clean --force`

### Debug Mode

Enable debug mode for detailed logging and visual output:

1. Set `debugMode = true` in `src/index.ts`
2. Rebuild: `npm run build`
3. Check `output/` directory for debug images
4. Review console output for detailed processing logs

## 📝 Dependencies

### Core Dependencies

- **TypeScript** - Type-safe JavaScript development
- **pdf2pic** - PDF to image conversion
- **Tesseract.js** - OCR text recognition
- **Sharp** - High-performance image processing
- **colorjs.io** - Color space calculations

### Development Dependencies

- **ts-node** - TypeScript execution for development
- **@types/node** - TypeScript definitions for Node.js

**Built with ❤️ using TypeScript and modern Node.js technologies**
