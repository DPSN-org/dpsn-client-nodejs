// Script to fix ESM imports by adding .cjs extensions
const fs = require('fs');
const path = require('path');

// Directory to process
const esmDir = path.resolve(__dirname, 'dist/esm');

// Function to process a file
function processFile(filePath) {
  if (!filePath.endsWith('.js')) return;
  
  console.log(`Processing ${filePath}`);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace relative imports without extensions
  // This regex looks for import statements with relative paths ('./' or '../') without file extensions
  const importRegex = /from\s+['"]([\.\/][^'"]*?)['"];/g;
  content = content.replace(importRegex, (match, importPath) => {
    // Skip if the import already has an extension
    if (importPath.endsWith('.js')) return match;
    
    // Add .js extension
    return match.replace(importPath, `${importPath}.js`);
  });
  
  // Also handle dynamic imports
  const dynamicImportRegex = /import\(\s*['"]([\.\/][^'"]*?)['"]\s*\)/g;
  content = content.replace(dynamicImportRegex, (match, importPath) => {
    // Skip if the import already has an extension
    if (importPath.endsWith('.js')) return match;
    
    // Add .js extension
    return match.replace(importPath, `${importPath}.js`);
  });
  
  fs.writeFileSync(filePath, content, 'utf8');
}

// Function to process a directory recursively
function processDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.error(`Directory does not exist: ${dirPath}`);
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else {
      processFile(fullPath);
    }
  }
}

// Start processing
console.log('Fixing ESM imports...');
try {
  processDirectory(esmDir);
  console.log('Done fixing ESM imports.');
} catch (error) {
  console.error('Error fixing ESM imports:', error);
  process.exit(1);
}
