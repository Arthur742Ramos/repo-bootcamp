/**
 * Tests for security analysis
 */

import { describe, it, expect } from "vitest";
import { generateSecurityDocs, getSecurityGrade, type SecurityAnalysis } from "../src/security.js";

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
