#!/usr/bin/env node

/**
 * Quality Check Script
 * 
 * Comprehensive quality assurance script that validates all acceptance criteria
 * and ensures production readiness of the MCP server implementation.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for output formatting
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

class QualityChecker {
  constructor() {
    this.results = {
      passed: [],
      failed: [],
      warnings: []
    };
    this.startTime = Date.now();
  }

  log(message, color = 'reset') {
    const timestamp = new Date().toISOString();
    console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
  }

  success(message) {
    this.log(`✅ ${message}`, 'green');
    this.results.passed.push(message);
  }

  error(message) {
    this.log(`❌ ${message}`, 'red');
    this.results.failed.push(message);
  }

  warning(message) {
    this.log(`⚠️  ${message}`, 'yellow');
    this.results.warnings.push(message);
  }

  info(message) {
    this.log(`ℹ️  ${message}`, 'blue');
  }

  section(title) {
    this.log(`\n${colors.bright}=== ${title} ===${colors.reset}`, 'cyan');
  }

  async runCommand(command, options = {}) {
    try {
      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        ...options
      });
      return { success: true, output: result };
    } catch (error) {
      return { 
        success: false, 
        output: error.stdout || error.message,
        error: error.stderr || error.message
      };
    }
  }

  async checkTypeScript() {
    this.section('TypeScript Compilation Check');
    
    const result = await this.runCommand('npm run build');
    if (result.success) {
      this.success('TypeScript compilation successful');
      return true;
    } else {
      this.error(`TypeScript compilation failed: ${result.error}`);
      return false;
    }
  }

  async checkLinting() {
    this.section('Code Linting Check');
    
    const result = await this.runCommand('npm run lint');
    if (result.success) {
      this.success('Code linting passed');
      return true;
    } else {
      this.error(`Linting failed: ${result.error}`);
      return false;
    }
  }

  async checkFormatting() {
    this.section('Code Formatting Check');
    
    const result = await this.runCommand('npm run format:check');
    if (result.success) {
      this.success('Code formatting is correct');
      return true;
    } else {
      this.warning(`Code formatting issues detected: ${result.output}`);
      return false;
    }
  }

  async checkTestCoverage() {
    this.section('Test Coverage Check');
    
    const result = await this.runCommand('npm run test:coverage');
    if (!result.success) {
      this.error(`Test execution failed: ${result.error}`);
      return false;
    }

    // Parse coverage report
    const coveragePath = path.join(__dirname, '../coverage/coverage-final.json');
    if (!fs.existsSync(coveragePath)) {
      this.error('Coverage report not found');
      return false;
    }

    try {
      const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
      const totals = Object.values(coverage).reduce((acc, file) => {
        if (file.s) { // Statement coverage
          acc.statements.covered += Object.values(file.s).filter(v => v > 0).length;
          acc.statements.total += Object.values(file.s).length;
        }
        if (file.b) { // Branch coverage
          acc.branches.covered += Object.values(file.b).flat().filter(v => v > 0).length;
          acc.branches.total += Object.values(file.b).flat().length;
        }
        if (file.f) { // Function coverage
          acc.functions.covered += Object.values(file.f).filter(v => v > 0).length;
          acc.functions.total += Object.values(file.f).length;
        }
        if (file.l) { // Line coverage
          acc.lines.covered += Object.values(file.l).filter(v => v > 0).length;
          acc.lines.total += Object.values(file.l).length;
        }
        return acc;
      }, {
        statements: { covered: 0, total: 0 },
        branches: { covered: 0, total: 0 },
        functions: { covered: 0, total: 0 },
        lines: { covered: 0, total: 0 }
      });

      const statementCoverage = (totals.statements.covered / totals.statements.total) * 100;
      const branchCoverage = (totals.branches.covered / totals.branches.total) * 100;
      const functionCoverage = (totals.functions.covered / totals.functions.total) * 100;
      const lineCoverage = (totals.lines.covered / totals.lines.total) * 100;

      this.info(`Statement Coverage: ${statementCoverage.toFixed(2)}%`);
      this.info(`Branch Coverage: ${branchCoverage.toFixed(2)}%`);
      this.info(`Function Coverage: ${functionCoverage.toFixed(2)}%`);
      this.info(`Line Coverage: ${lineCoverage.toFixed(2)}%`);

      const targetCoverage = 80;
      if (statementCoverage >= targetCoverage && lineCoverage >= targetCoverage) {
        this.success(`Test coverage meets requirement (≥${targetCoverage}%)`);
        return true;
      } else {
        this.error(`Test coverage below requirement (${targetCoverage}%)`);
        return false;
      }
    } catch (error) {
      this.error(`Failed to parse coverage report: ${error.message}`);
      return false;
    }
  }

  async checkDependencies() {
    this.section('Dependency Security Check');
    
    const result = await this.runCommand('npm audit --audit-level moderate');
    if (result.success || result.output.includes('found 0 vulnerabilities')) {
      this.success('No security vulnerabilities found in dependencies');
      return true;
    } else {
      this.warning(`Security vulnerabilities detected: ${result.output}`);
      return false;
    }
  }

  async checkCircularDependencies() {
    this.section('Circular Dependencies Check');
    
    const result = await this.runCommand('npm run check:deps');
    if (result.success) {
      this.success('No circular dependencies found');
      return true;
    } else {
      this.error(`Circular dependencies detected: ${result.output}`);
      return false;
    }
  }

  async checkUnusedCode() {
    this.section('Unused Code Check');
    
    const result = await this.runCommand('npm run check:unused');
    if (result.success) {
      this.success('No unused exports found');
      return true;
    } else {
      this.warning(`Unused exports detected: ${result.output}`);
      return false; // Treat as warning for now
    }
  }

  async checkAcceptanceCriteria() {
    this.section('Acceptance Criteria Verification');
    
    // Check if all specific test suites pass
    const testSuites = [
      { name: 'E2E Integration Tests', path: '__tests__/integration/e2e.test.ts' },
      { name: 'Performance Tests', path: '__tests__/performance/startup.test.ts' },
      { name: 'Execution Performance Tests', path: '__tests__/performance/execution.test.ts' },
      { name: 'Security Tests', path: '__tests__/security/validation.test.ts' }
    ];

    let allPassed = true;
    for (const suite of testSuites) {
      if (fs.existsSync(path.join(__dirname, '..', suite.path))) {
        const result = await this.runCommand(`npx vitest run ${suite.path}`);
        if (result.success) {
          this.success(`${suite.name} passed`);
        } else {
          this.error(`${suite.name} failed: ${result.error}`);
          allPassed = false;
        }
      } else {
        this.warning(`${suite.name} file not found: ${suite.path}`);
        allPassed = false;
      }
    }

    return allPassed;
  }

  async checkPerformanceRequirements() {
    this.section('Performance Requirements Verification');
    
    // This would ideally run actual performance benchmarks
    // For now, we verify that performance tests exist and pass
    const performanceTestResult = await this.runCommand('npx vitest run __tests__/performance/');
    
    if (performanceTestResult.success) {
      this.success('Performance requirements verified');
      return true;
    } else {
      this.error(`Performance requirements not met: ${performanceTestResult.error}`);
      return false;
    }
  }

  async checkCodeQuality() {
    this.section('Code Quality Standards');
    
    // Check TypeScript strict mode compliance
    const tsconfigPath = path.join(__dirname, '../tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
      if (tsconfig.compilerOptions && tsconfig.compilerOptions.strict === true) {
        this.success('TypeScript strict mode enabled');
      } else {
        this.error('TypeScript strict mode not enabled');
        return false;
      }
    }

    // Check for any type violations
    const result = await this.runCommand('npx tsc --noEmit');
    if (result.success) {
      this.success('No TypeScript type errors');
      return true;
    } else {
      this.error(`TypeScript type errors: ${result.error}`);
      return false;
    }
  }

  async checkDocumentation() {
    this.section('Documentation Completeness');
    
    const requiredDocs = [
      { path: 'README.md', name: 'README file' },
      { path: 'docs/design/sub-agents-mcp-design.md', name: 'Design document' },
      { path: 'package.json', name: 'Package configuration' }
    ];

    let allPresent = true;
    for (const doc of requiredDocs) {
      const fullPath = path.join(__dirname, '..', doc.path);
      if (fs.existsSync(fullPath)) {
        this.success(`${doc.name} exists`);
      } else {
        this.error(`${doc.name} missing: ${doc.path}`);
        allPresent = false;
      }
    }

    return allPresent;
  }

  async checkLanguageCompliance() {
    this.section('English Language Compliance');
    
    // Check for Japanese characters in source code (excluding comments that explain the requirement)
    const sourceFiles = this.getSourceFiles();
    let compliant = true;

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment lines that are explaining the English requirement
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        
        // Check for Japanese characters (Hiragana, Katakana, Kanji)
        if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(line)) {
          this.error(`Japanese characters found in ${file}:${i + 1}: ${line.trim()}`);
          compliant = false;
        }
      }
    }

    if (compliant) {
      this.success('All source code uses English language');
    }

    return compliant;
  }

  getSourceFiles() {
    const sourceFiles = [];
    const srcDir = path.join(__dirname, '../src');
    
    function walkDir(dir) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          walkDir(fullPath);
        } else if (file.endsWith('.ts') || file.endsWith('.js')) {
          sourceFiles.push(fullPath);
        }
      }
    }
    
    if (fs.existsSync(srcDir)) {
      walkDir(srcDir);
    }
    
    return sourceFiles;
  }

  async generateQualityReport() {
    const duration = Date.now() - this.startTime;
    
    this.section('Quality Check Summary');
    this.info(`Total duration: ${(duration / 1000).toFixed(2)} seconds`);
    this.info(`Passed checks: ${this.results.passed.length}`);
    this.info(`Failed checks: ${this.results.failed.length}`);
    this.info(`Warnings: ${this.results.warnings.length}`);

    const isQualityReady = this.results.failed.length === 0;
    
    if (isQualityReady) {
      this.success('🎉 All quality checks passed! Ready for production.');
    } else {
      this.error('❌ Quality checks failed. Please address the issues above.');
    }

    // Ensure tmp directory exists
    const tmpDir = path.join(__dirname, '../tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Generate detailed report file in tmp directory
    const reportPath = path.join(tmpDir, 'quality-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      duration: duration,
      summary: {
        passed: this.results.passed.length,
        failed: this.results.failed.length,
        warnings: this.results.warnings.length,
        ready: isQualityReady
      },
      details: this.results
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    this.info(`Detailed report saved to: ${reportPath}`);

    return isQualityReady;
  }

  async run() {
    this.log('Starting comprehensive quality check...', 'bright');

    const checks = [
      () => this.checkTypeScript(),
      () => this.checkLinting(),
      () => this.checkFormatting(),
      () => this.checkTestCoverage(),
      () => this.checkDependencies(),
      () => this.checkCircularDependencies(),
      () => this.checkUnusedCode(),
      () => this.checkCodeQuality(),
      () => this.checkLanguageCompliance(),
      () => this.checkDocumentation(),
      () => this.checkAcceptanceCriteria(),
      () => this.checkPerformanceRequirements()
    ];

    for (const check of checks) {
      try {
        await check();
      } catch (error) {
        this.error(`Check failed with error: ${error.message}`);
      }
    }

    const isReady = await this.generateQualityReport();
    process.exit(isReady ? 0 : 1);
  }
}

// Run quality check if this script is executed directly
if (require.main === module) {
  const checker = new QualityChecker();
  checker.run().catch(error => {
    console.error('Quality check failed with error:', error);
    process.exit(1);
  });
}

module.exports = QualityChecker;