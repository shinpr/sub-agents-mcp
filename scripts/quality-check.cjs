#!/usr/bin/env node


const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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
    
    const result = await this.runCommand('pnpm run build');
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
    
    const result = await this.runCommand('pnpm run lint');
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
    
    const result = await this.runCommand('pnpm run format:check');
    if (result.success) {
      this.success('Code formatting is correct');
      return true;
    } else {
      this.warning(`Code formatting issues detected: ${result.output}`);
      return false;
    }
  }

  async checkDependencies() {
    this.section('Dependency Security Check');
    
    const result = await this.runCommand('pnpm audit --audit-level moderate');
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
    
    const result = await this.runCommand('pnpm run check:deps');
    if (result.success) {
      this.success('No circular dependencies found');
      return true;
    } else {
      this.error(`Circular dependencies detected: ${result.output}`);
      return false;
    }
  }

  async checkAcceptanceCriteria() {
    this.section('Acceptance Criteria Verification');
    
    const testSuites = [
      { name: 'E2E Integration Tests', path: '__tests__/integration/e2e.test.ts' },
      { name: 'Performance Tests', path: '__tests__/performance/startup.test.ts' },
      { name: 'Execution Performance Tests', path: '__tests__/performance/execution.test.ts' },
      { name: 'Security Tests', path: '__tests__/security/validation.test.ts' }
    ];

    let allPassed = true;
    for (const suite of testSuites) {
      if (fs.existsSync(path.join(__dirname, '..', suite.path))) {
        const result = await this.runCommand(`pnpm exec vitest run ${suite.path}`);
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
    
    const performanceTestResult = await this.runCommand('pnpm exec vitest run __tests__/performance/');
    
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

    const result = await this.runCommand('pnpm exec tsc --noEmit');
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
    
    const sourceFiles = this.getSourceFiles();
    let compliant = true;

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        
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

    const tmpDir = path.join(__dirname, '../tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

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
      () => this.checkDependencies(),
      () => this.checkCircularDependencies(),
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

if (require.main === module) {
  const checker = new QualityChecker();
  checker.run().catch(error => {
    console.error('Quality check failed with error:', error);
    process.exit(1);
  });
}

module.exports = QualityChecker;
