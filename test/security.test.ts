/**
 * Tests for security analysis
 */

import { describe, it, expect, afterEach } from "vitest";
import { generateSecurityDocs, getSecurityGrade, analyzeSecurityPatterns, type SecurityAnalysis } from "../src/security.js";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import type { FileInfo } from "../src/types.js";

describe("getSecurityGrade", () => {
  it("should return A for 90+", () => {
    expect(getSecurityGrade(90)).toBe("A");
    expect(getSecurityGrade(95)).toBe("A");
    expect(getSecurityGrade(100)).toBe("A");
  });

  it("should return B for 80-89", () => {
    expect(getSecurityGrade(80)).toBe("B");
    expect(getSecurityGrade(85)).toBe("B");
    expect(getSecurityGrade(89)).toBe("B");
  });

  it("should return C for 70-79", () => {
    expect(getSecurityGrade(70)).toBe("C");
    expect(getSecurityGrade(75)).toBe("C");
  });

  it("should return D for 60-69", () => {
    expect(getSecurityGrade(60)).toBe("D");
    expect(getSecurityGrade(65)).toBe("D");
  });

  it("should return F for below 60", () => {
    expect(getSecurityGrade(59)).toBe("F");
    expect(getSecurityGrade(0)).toBe("F");
  });
});

describe("generateSecurityDocs", () => {
  const mockAnalysis: SecurityAnalysis = {
    score: 85,
    authPatterns: [
      {
        type: "JWT",
        library: "jsonwebtoken",
        files: ["src/auth.ts"],
        description: "Uses JSON Web Tokens for stateless auth",
      },
    ],
    securityDeps: [
      { name: "helmet", purpose: "Security headers middleware", type: "security-header" },
      { name: "bcrypt", purpose: "Password hashing", type: "crypto" },
      { name: "zod", purpose: "Schema validation", type: "validation" },
    ],
    findings: [
      {
        category: "XSS",
        title: "dangerouslySetInnerHTML usage",
        description: "React's dangerouslySetInnerHTML can introduce XSS vulnerabilities",
        severity: "medium",
        file: "src/components/Content.tsx",
        line: 42,
        recommendation: "Ensure content is sanitized before use",
      },
    ],
    secretsHandling: {
      envFiles: [".env"],
      configFiles: [],
      gitignoreSecrets: true,
      hasEnvExample: true,
    },
    headers: {
      hasHelmet: true,
      hasCors: true,
      hasCSP: false,
    },
    hasRateLimiting: false,
    hasInputValidation: true,
    hasSqlInjectionPrevention: true,
  };

  it("should generate markdown documentation", () => {
    const docs = generateSecurityDocs(mockAnalysis, "my-app");
    
    expect(docs).toContain("# Security Overview");
    expect(docs).toContain("my-app");
  });

  it("should show security score", () => {
    const docs = generateSecurityDocs(mockAnalysis, "my-app");
    
    expect(docs).toContain("## Security Score");
    expect(docs).toContain("85/100");
    expect(docs).toContain("Grade: B");
  });

  it("should list security measures", () => {
    const docs = generateSecurityDocs(mockAnalysis, "my-app");
    
    expect(docs).toContain("## Security Measures");
    expect(docs).toContain("Security headers (Helmet)");
    expect(docs).toContain("CORS configured");
    expect(docs).toContain("Input validation");
  });

  it("should show authentication patterns", () => {
    const docs = generateSecurityDocs(mockAnalysis, "my-app");
    
    expect(docs).toContain("## Authentication");
    expect(docs).toContain("### JWT");
    expect(docs).toContain("jsonwebtoken");
  });

  it("should list security dependencies", () => {
    const docs = generateSecurityDocs(mockAnalysis, "my-app");
    
    expect(docs).toContain("## Security Dependencies");
    expect(docs).toContain("helmet");
    expect(docs).toContain("bcrypt");
    expect(docs).toContain("zod");
  });

  it("should show findings by severity", () => {
    const docs = generateSecurityDocs(mockAnalysis, "my-app");
    
    expect(docs).toContain("## Findings");
    expect(docs).toContain("Medium");
    expect(docs).toContain("dangerouslySetInnerHTML usage");
  });

  it("should show secrets handling info", () => {
    const docs = generateSecurityDocs(mockAnalysis, "my-app");
    
    expect(docs).toContain("## Secrets Handling");
    expect(docs).toContain(".env");
  });

  it("should include recommendations", () => {
    const docs = generateSecurityDocs(mockAnalysis, "my-app");
    
    expect(docs).toContain("## Recommendations");
    // Should recommend rate limiting since it's missing
    expect(docs).toContain("rate limiting");
  });
});

describe("SecurityAnalysis with critical findings", () => {
  const criticalAnalysis: SecurityAnalysis = {
    score: 45,
    authPatterns: [],
    securityDeps: [],
    findings: [
      {
        category: "Secrets",
        title: "Hardcoded password",
        description: "Passwords should not be hardcoded",
        severity: "critical",
        file: "src/config.ts",
        line: 10,
        recommendation: "Use environment variables",
      },
      {
        category: "SQL Injection",
        title: "Potential SQL injection",
        description: "Template literals in SQL queries",
        severity: "critical",
        file: "src/db.ts",
        line: 25,
        recommendation: "Use parameterized queries",
      },
    ],
    secretsHandling: {
      envFiles: [],
      configFiles: [],
      gitignoreSecrets: false,
      hasEnvExample: false,
    },
    headers: {
      hasHelmet: false,
      hasCors: false,
      hasCSP: false,
    },
    hasRateLimiting: false,
    hasInputValidation: false,
    hasSqlInjectionPrevention: false,
  };

  it("should show critical findings prominently", () => {
    const docs = generateSecurityDocs(criticalAnalysis, "insecure-app");
    
    expect(docs).toContain("Critical");
    expect(docs).toContain("Hardcoded password");
    expect(docs).toContain("SQL injection");
  });

  it("should show low score for insecure app", () => {
    const docs = generateSecurityDocs(criticalAnalysis, "insecure-app");
    
    expect(docs).toContain("45/100");
    expect(getSecurityGrade(45)).toBe("F");
  });

  it("should prioritize addressing critical findings", () => {
    const docs = generateSecurityDocs(criticalAnalysis, "insecure-app");
    
    expect(docs).toContain("Priority");
    expect(docs).toContain("critical security findings");
  });
});

describe("SecurityAnalysis with no findings", () => {
  const cleanAnalysis: SecurityAnalysis = {
    score: 100,
    authPatterns: [],
    securityDeps: [
      { name: "helmet", purpose: "Security headers", type: "security-header" },
    ],
    findings: [],
    secretsHandling: {
      envFiles: [],
      configFiles: [],
      gitignoreSecrets: true,
      hasEnvExample: true,
    },
    headers: {
      hasHelmet: true,
      hasCors: true,
      hasCSP: true,
    },
    hasRateLimiting: true,
    hasInputValidation: true,
    hasSqlInjectionPrevention: true,
  };

  it("should show clean message when no findings", () => {
    const docs = generateSecurityDocs(cleanAnalysis, "secure-app");
    
    expect(docs).toContain("No security concerns detected");
  });

  it("should show good recommendations message", () => {
    const docs = generateSecurityDocs(cleanAnalysis, "secure-app");
    
    expect(docs).toContain("security posture looks good");
  });
});

describe("edge cases", () => {
  it("handles edge of grade boundaries", () => {
    expect(getSecurityGrade(90)).toBe("A");
    expect(getSecurityGrade(89.9)).toBe("B");
    expect(getSecurityGrade(80)).toBe("B");
    expect(getSecurityGrade(79.9)).toBe("C");
    expect(getSecurityGrade(70)).toBe("C");
    expect(getSecurityGrade(69.9)).toBe("D");
    expect(getSecurityGrade(60)).toBe("D");
    expect(getSecurityGrade(59.9)).toBe("F");
  });

  it("handles negative scores", () => {
    expect(getSecurityGrade(-10)).toBe("F");
  });

  it("handles scores over 100", () => {
    expect(getSecurityGrade(110)).toBe("A");
  });

  it("handles empty repo name", () => {
    const minimalAnalysis: SecurityAnalysis = {
      score: 50,
      authPatterns: [],
      securityDeps: [],
      findings: [],
      secretsHandling: {
        envFiles: [],
        configFiles: [],
        gitignoreSecrets: false,
        hasEnvExample: false,
      },
      headers: {
        hasHelmet: false,
        hasCors: false,
        hasCSP: false,
      },
      hasRateLimiting: false,
      hasInputValidation: false,
      hasSqlInjectionPrevention: false,
    };
    const docs = generateSecurityDocs(minimalAnalysis, "");
    expect(docs).toContain("# Security Overview");
  });

  it("handles special characters in repo name", () => {
    const minimalAnalysis: SecurityAnalysis = {
      score: 75,
      authPatterns: [],
      securityDeps: [],
      findings: [],
      secretsHandling: {
        envFiles: [],
        configFiles: [],
        gitignoreSecrets: true,
        hasEnvExample: true,
      },
      headers: {
        hasHelmet: false,
        hasCors: false,
        hasCSP: false,
      },
      hasRateLimiting: false,
      hasInputValidation: true,
      hasSqlInjectionPrevention: true,
    };
    const docs = generateSecurityDocs(minimalAnalysis, "@org/my-pkg");
    expect(docs).toContain("@org/my-pkg");
  });

  it("handles high severity findings", () => {
    const highSeverityAnalysis: SecurityAnalysis = {
      score: 55,
      authPatterns: [],
      securityDeps: [],
      findings: [
        {
          category: "XSS",
          title: "Script injection",
          description: "User input not sanitized",
          severity: "high",
          file: "src/render.ts",
          line: 100,
          recommendation: "Sanitize input",
        },
      ],
      secretsHandling: {
        envFiles: [],
        configFiles: [],
        gitignoreSecrets: true,
        hasEnvExample: false,
      },
      headers: {
        hasHelmet: false,
        hasCors: false,
        hasCSP: false,
      },
      hasRateLimiting: false,
      hasInputValidation: false,
      hasSqlInjectionPrevention: false,
    };
    const docs = generateSecurityDocs(highSeverityAnalysis, "app");
    expect(docs).toContain("High");
    expect(docs).toContain("Script injection");
  });

  it("handles low severity findings", () => {
    const lowSeverityAnalysis: SecurityAnalysis = {
      score: 90,
      authPatterns: [],
      securityDeps: [],
      findings: [
        {
          category: "Info",
          title: "Missing strict mode",
          description: "Consider using strict mode",
          severity: "low",
          file: "src/index.ts",
          line: 1,
          recommendation: "Add 'use strict'",
        },
      ],
      secretsHandling: {
        envFiles: [],
        configFiles: [],
        gitignoreSecrets: true,
        hasEnvExample: true,
      },
      headers: {
        hasHelmet: true,
        hasCors: true,
        hasCSP: false,
      },
      hasRateLimiting: true,
      hasInputValidation: true,
      hasSqlInjectionPrevention: true,
    };
    const docs = generateSecurityDocs(lowSeverityAnalysis, "app");
    // Low severity is grouped as "Informational" 
    expect(docs).toContain("Informational");
    expect(docs).toContain("1 informational findings");
  });
});

describe("analyzeSecurityPatterns", () => {
  const testDir = "/tmp/test-security-analysis";

  async function setupTestRepo(files: Record<string, string>): Promise<FileInfo[]> {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });

    const fileInfos: FileInfo[] = [];
    for (const [name, content] of Object.entries(files)) {
      const dir = join(testDir, name.includes("/") ? name.substring(0, name.lastIndexOf("/")) : "");
      await mkdir(dir, { recursive: true });
      await writeFile(join(testDir, name), content);
      fileInfos.push({ path: name, size: content.length, isDirectory: false });
    }
    return fileInfos;
  }

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("detects helmet dependency as security header", async () => {
    const files = await setupTestRepo({ "src/app.ts": "const app = express();" });
    const result = await analyzeSecurityPatterns(testDir, files, {
      dependencies: { helmet: "^7.0.0" },
    });

    expect(result.headers.hasHelmet).toBe(true);
    expect(result.securityDeps.some(d => d.name === "helmet")).toBe(true);
  });

  it("detects ORM as SQL injection prevention", async () => {
    const files = await setupTestRepo({ "src/db.ts": "import { PrismaClient } from '@prisma/client';" });
    const result = await analyzeSecurityPatterns(testDir, files, {
      dependencies: { "@prisma/client": "^5.0.0" },
    });

    expect(result.hasSqlInjectionPrevention).toBe(true);
  });

  it("detects rate limiting package", async () => {
    const files = await setupTestRepo({ "src/app.ts": "const app = express();" });
    const result = await analyzeSecurityPatterns(testDir, files, {
      dependencies: { "express-rate-limit": "^7.0.0" },
    });

    expect(result.hasRateLimiting).toBe(true);
  });

  it("detects .env files in secrets handling", async () => {
    const files: FileInfo[] = [
      { path: ".env", size: 100, isDirectory: false },
      { path: ".env.local", size: 50, isDirectory: false },
      { path: ".env.example", size: 30, isDirectory: false },
      { path: "src/app.ts", size: 200, isDirectory: false },
    ];
    await setupTestRepo({ "src/app.ts": "console.log('hello');" });

    const result = await analyzeSecurityPatterns(testDir, files);

    expect(result.secretsHandling.envFiles).toContain(".env");
    expect(result.secretsHandling.envFiles).toContain(".env.local");
    expect(result.secretsHandling.hasEnvExample).toBe(true);
    // .env.example should NOT be in envFiles
    expect(result.secretsHandling.envFiles).not.toContain(".env.example");
  });

  it("detects gitignore secrets patterns", async () => {
    const files = await setupTestRepo({
      ".gitignore": ".env\n*.pem\nsecrets/\nnode_modules/",
      "src/app.ts": "console.log('safe');",
    });

    const result = await analyzeSecurityPatterns(testDir, files);

    expect(result.secretsHandling.gitignoreSecrets).toBe(true);
  });

  it("starts with score 100 for clean repo with no deps", async () => {
    const files = await setupTestRepo({
      "src/clean.ts": "export function add(a: number, b: number) { return a + b; }",
    });

    const result = await analyzeSecurityPatterns(testDir, files);

    expect(result.score).toBe(100);
  });

  it("deducts score for security findings", async () => {
    const files = await setupTestRepo({
      "src/bad.ts": 'const password = "hardcoded123";',
    });

    const result = await analyzeSecurityPatterns(testDir, files);

    expect(result.score).toBeLessThan(100);
  });

  it("skips test files for security concerns", async () => {
    const files = await setupTestRepo({
      "src/app.test.ts": 'const password = "test123"; // test fixture',
    });

    const result = await analyzeSecurityPatterns(testDir, files);

    expect(result.findings.length).toBe(0);
  });

  it("skips comment lines for security concerns", async () => {
    const files = await setupTestRepo({
      "src/app.ts": '// const password = "old_password";\nconst x = 1;',
    });

    const result = await analyzeSecurityPatterns(testDir, files);

    const passwordFindings = result.findings.filter(f => f.title.toLowerCase().includes("password"));
    expect(passwordFindings.length).toBe(0);
  });

  it("handles missing .gitignore gracefully", async () => {
    const files = await setupTestRepo({
      "src/app.ts": "export const x = 1;",
    });

    const result = await analyzeSecurityPatterns(testDir, files);

    expect(result.secretsHandling.gitignoreSecrets).toBe(false);
  });

  it("clamps score between 0 and 100", async () => {
    const files = await setupTestRepo({
      ".gitignore": ".env\n*.pem",
      "src/app.ts": "export const x = 1;",
    });

    const result = await analyzeSecurityPatterns(testDir, files, {
      dependencies: {
        helmet: "^7.0.0",
        cors: "^2.0.0",
        "express-rate-limit": "^7.0.0",
        zod: "^3.0.0",
        "@prisma/client": "^5.0.0",
      },
    });

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("detects CSP in source files", async () => {
    const files = await setupTestRepo({
      "src/server.ts": 'res.setHeader("Content-Security-Policy", "default-src \'self\'");',
    });

    const result = await analyzeSecurityPatterns(testDir, files);

    expect(result.headers.hasCSP).toBe(true);
  });

  it("filters non-source files from scanning", async () => {
    const files: FileInfo[] = [
      { path: "README.md", size: 500, isDirectory: false },
      { path: "image.png", size: 10000, isDirectory: false },
      { path: "data.csv", size: 2000, isDirectory: false },
    ];
    await setupTestRepo({ "README.md": "# Docs" });

    const result = await analyzeSecurityPatterns(testDir, files);

    expect(result.findings.length).toBe(0);
  });
});
