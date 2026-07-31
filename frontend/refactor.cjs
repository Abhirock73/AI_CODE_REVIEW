const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src');

function walk(directory, callback) {
  fs.readdirSync(directory).forEach(file => {
    const fullPath = path.join(directory, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath, callback);
    } else if (fullPath.endsWith('.jsx') || fullPath.endsWith('.js')) {
      if (file !== 'api.js' && file !== 'authSlice.js') { // skip these
        callback(fullPath);
      }
    }
  });
}

walk(dir, (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // 1. replace fetch( with apiFetch(
  content = content.replace(/\bfetch\(/g, 'apiFetch(');

  // 2. Add import { apiFetch } from '[relPath]' if apiFetch is used
  if (content.includes('apiFetch(') && !content.includes('import { apiFetch }')) {
    const relativePath = path.relative(path.dirname(filePath), path.join(dir, 'utils', 'api'));
    let importPath = relativePath.replace(/\\/g, '/');
    if (!importPath.startsWith('.')) {
      importPath = './' + importPath;
    }
    const importStmt = `import { apiFetch } from '${importPath}';\n`;
    content = importStmt + content;
  }

  // 3. Remove headers: { Authorization: `Bearer ${token}` }
  content = content.replace(/,\s*Authorization:\s*`Bearer \$\{token\}`/g, '');
  content = content.replace(/Authorization:\s*`Bearer \$\{token\}`\s*,?/g, '');
  
  // also clean up empty headers: {} or {  }
  content = content.replace(/headers:\s*{\s*}\s*,?/g, '');
  
  // Clean up if it left a dangling comma after content-type:
  // e.g. headers: { 'Content-Type': 'application/json', } -> headers: { 'Content-Type': 'application/json' }
  content = content.replace(/,\s*}/g, ' }');

  // 4. XHR fix
  content = content.replace(/xhr\.setRequestHeader\('Authorization',\s*`Bearer \$\{token\}`\);/g, 'xhr.withCredentials = true;');

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  }
});
