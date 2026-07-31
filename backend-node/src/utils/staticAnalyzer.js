const fs = require('fs').promises;
const path = require('path');
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const Python = require('tree-sitter-python');
const { execFile } = require('child_process');

const jsParser = new Parser();
jsParser.setLanguage(JavaScript);

const pyParser = new Parser();
pyParser.setLanguage(Python);

/**
 * Parses code and calculates cyclomatic complexity (mocked implementation)
 */
function analyzeCodeComplexity(code, extension) {
  let parser;
  if (extension === '.js' || extension === '.jsx' || extension === '.ts' || extension === '.tsx') {
    parser = jsParser;
  } else if (extension === '.py') {
    parser = pyParser;
  } else {
    return { complexity: 'N/A', warnings: ['Unsupported language for complexity analysis'] };
  }

  try {
    const tree = parser.parse(code);
    
    // A simplified complexity heuristic: count control flow statements
    let complexity = 1;
    const warnings = [];
    
    const cursor = tree.walk();
    const traverse = (c) => {
      const type = c.nodeType;
      // JS specific checks
      if (['if_statement', 'for_statement', 'while_statement', 'catch_clause', 'ternary_expression'].includes(type)) {
        complexity++;
      }
      
      // Basic security check: eval
      if (type === 'call_expression') {
        const text = c.currentNode.text;
        if (text.startsWith('eval(')) {
          warnings.push('Security Warning: usage of eval() detected');
        }
      }

      if (c.gotoFirstChild()) {
        do {
          traverse(c);
        } while (c.gotoNextSibling());
        c.gotoParent();
      }
    };
    
    traverse(cursor);
    
    return { complexity, warnings };
  } catch (err) {
    console.error('Tree-sitter parsing error:', err);
    return { complexity: 'Error', warnings: ['Failed to parse file'] };
  }
}

/**
 * Runs dependency-cruiser CLI on a directory
 */
async function generateDependencyGraph(dirPath) {
  return new Promise((resolve) => {
    const depcruise = path.join(
      __dirname, '..', '..', 'node_modules', '.bin', 'depcruise'
    );
    execFile(
      depcruise,
      ['--output-type', 'json', '--exclude', 'node_modules', dirPath],
      { timeout: 30000 },
      (err, stdout) => {
        if (err) {
          console.error('Dependency cruiser error:', err.message);
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Runs the full static analysis pipeline for a file
 */
async function analyzeFile(filePath, extension) {
  try {
    const code = await fs.readFile(filePath, 'utf8');
    const analysis = analyzeCodeComplexity(code, extension);
    return analysis;
  } catch (err) {
    return { error: 'Failed to read file for analysis' };
  }
}

module.exports = {
  analyzeCodeComplexity,
  generateDependencyGraph,
  analyzeFile
};
