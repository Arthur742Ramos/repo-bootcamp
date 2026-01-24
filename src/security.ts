/**
 * Security Analysis Module
 * Detects security patterns, auth flows, secrets handling, and potential concerns
 */

import { readFile } from "fs/promises";
import { join, basename } from "path";
import type { FileInfo } from "./types.js";

/**
 * Security finding severity levels
 */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/**
 * A security finding or observation
 */
export interface SecurityFinding {
  category: string;
  title: string;
  description: string;
  severity: Severity;
  file?: string;
  line?: number;
  recommendation?: string;
}

/**
 * Authentication pattern detected
 */
export interface AuthPattern {
  type: string;
  library?: string;
  files: string[];
  description: string;
}

/**
 * Security-related dependency
 */
export interface SecurityDependency {
  name: string;
  purpose: string;
  type: "auth" | "crypto" | "validation" | "security-header" | "rate-limit" | "other";
}

/**
 * Full security analysis result
 */
export interface SecurityAnalysis {
  score: number; // 0-100, higher is better
  authPatterns: AuthPattern[];
  securityDeps: SecurityDependency[];
  findings: SecurityFinding[];
  secretsHandling: {
    envFiles: string[];
    configFiles: string[];
    gitignoreSecrets: boolean;
    hasEnvExample: boolean;
  };
  headers: {
    hasHelmet: boolean;
    hasCors: boolean;
    hasCSP: boolean;
  };
  hasRateLimiting: boolean;
  hasInputValidation: boolean;
  hasSqlInjectionPrevention: boolean;
}

/**
 * Security-related npm packages
 */
const SECURITY_PACKAGES: Record<string, SecurityDependency> = {
  // Auth
  "passport": { name: "passport", purpose: "Authentication middleware", type: "auth" },
  "passport-local": { name: "passport-local", purpose: "Local authentication strategy", type: "auth" },
  "passport-jwt": { name: "passport-jwt", purpose: "JWT authentication strategy", type: "auth" },
  "passport-oauth2": { name: "passport-oauth2", purpose: "OAuth2 authentication", type: "auth" },
  "jsonwebtoken": { name: "jsonwebtoken", purpose: "JWT signing and verification", type: "auth" },
  "jose": { name: "jose", purpose: "Modern JWT/JWE/JWS library", type: "auth" },
  "next-auth": { name: "next-auth", purpose: "Next.js authentication", type: "auth" },
  "@auth/core": { name: "@auth/core", purpose: "Auth.js core", type: "auth" },
  "lucia": { name: "lucia", purpose: "Session-based auth library", type: "auth" },
  "@clerk/nextjs": { name: "@clerk/nextjs", purpose: "Clerk authentication", type: "auth" },
  "auth0": { name: "auth0", purpose: "Auth0 SDK", type: "auth" },
  "@supabase/supabase-js": { name: "@supabase/supabase-js", purpose: "Supabase (includes auth)", type: "auth" },
  "firebase": { name: "firebase", purpose: "Firebase (includes auth)", type: "auth" },

  // Crypto
  "bcrypt": { name: "bcrypt", purpose: "Password hashing", type: "crypto" },
  "bcryptjs": { name: "bcryptjs", purpose: "Password hashing (JS)", type: "crypto" },
  "argon2": { name: "argon2", purpose: "Password hashing (Argon2)", type: "crypto" },
  "crypto-js": { name: "crypto-js", purpose: "Cryptographic functions", type: "crypto" },
  "node-forge": { name: "node-forge", purpose: "TLS/crypto utilities", type: "crypto" },

  // Validation
  "zod": { name: "zod", purpose: "Schema validation", type: "validation" },
  "yup": { name: "yup", purpose: "Schema validation", type: "validation" },
  "joi": { name: "joi", purpose: "Schema validation", type: "validation" },
  "ajv": { name: "ajv", purpose: "JSON schema validation", type: "validation" },
  "class-validator": { name: "class-validator", purpose: "Decorator-based validation", type: "validation" },
  "express-validator": { name: "express-validator", purpose: "Express request validation", type: "validation" },
  "validator": { name: "validator", purpose: "String validation", type: "validation" },

  // Security headers
  "helmet": { name: "helmet", purpose: "Security headers middleware", type: "security-header" },
  "cors": { name: "cors", purpose: "CORS configuration", type: "security-header" },
  "csurf": { name: "csurf", purpose: "CSRF protection", type: "security-header" },

  // Rate limiting
  "express-rate-limit": { name: "express-rate-limit", purpose: "Rate limiting", type: "rate-limit" },
  "rate-limiter-flexible": { name: "rate-limiter-flexible", purpose: "Rate limiting", type: "rate-limit" },
  "@upstash/ratelimit": { name: "@upstash/ratelimit", purpose: "Serverless rate limiting", type: "rate-limit" },

  // Other
  "xss": { name: "xss", purpose: "XSS sanitization", type: "other" },
  "dompurify": { name: "dompurify", purpose: "HTML sanitization", type: "other" },
  "sanitize-html": { name: "sanitize-html", purpose: "HTML sanitization", type: "other" },
  "hpp": { name: "hpp", purpose: "HTTP parameter pollution prevention", type: "other" },
  "sql-template-strings": { name: "sql-template-strings", purpose: "SQL injection prevention", type: "other" },
};

/**
 * Patterns that might indicate security issues
 */
const CONCERN_PATTERNS: Array<{
  pattern: RegExp;
  title: string;
  severity: Severity;
  category: string;
  description: string;
  recommendation: string;
}> = [
  {
    pattern: /eval\s*\(/,
    title: "Use of eval()",
    severity: "high",
    category: "Code Injection",
    description: "eval() can execute arbitrary code and is a security risk",
    recommendation: "Use safer alternatives like JSON.parse() or Function constructor with validation",
  },
  {
    pattern: /innerHTML\s*=/,
    title: "Direct innerHTML assignment",
    severity: "medium",
    category: "XSS",
    description: "Direct innerHTML assignment can lead to XSS vulnerabilities",
    recommendation: "Use textContent or sanitize HTML before assignment",
  },
  {
    pattern: /dangerouslySetInnerHTML/,
    title: "dangerouslySetInnerHTML usage",
    severity: "medium",
    category: "XSS",
    description: "React's dangerouslySetInnerHTML can introduce XSS vulnerabilities",
    recommendation: "Ensure content is sanitized before use",
  },
  {
    pattern: /process\.env\.[A-Z_]+/,
    title: "Environment variable usage",
    severity: "info",
    category: "Configuration",
    description: "Environment variables are used for configuration",
    recommendation: "Ensure sensitive values are not logged or exposed",
  },
  {
    pattern: /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE)/i,
    title: "Potential SQL injection",
    severity: "critical",
    category: "SQL Injection",
    description: "Template literals in SQL queries may be vulnerable to injection",
    recommendation: "Use parameterized queries or an ORM",
  },
  {
    pattern: /exec\s*\(\s*['"`].*\$\{/,
    title: "Command injection risk",
    severity: "critical",
    category: "Command Injection",
    description: "Executing shell commands with user input is dangerous",
    recommendation: "Use child_process.spawn with an array of arguments",
  },
  {
    pattern: /password\s*[=:]\s*['"][^'"]+['"]/i,
    title: "Hardcoded password",
    severity: "critical",
    category: "Secrets",
    description: "Passwords should not be hardcoded in source code",
    recommendation: "Use environment variables or a secrets manager",
  },
  {
    pattern: /api[_-]?key\s*[=:]\s*['"][A-Za-z0-9]{20,}['"]/i,
    title: "Potential hardcoded API key",
    severity: "high",
    category: "Secrets",
    description: "API keys should not be hardcoded in source code",
    recommendation: "Use environment variables or a secrets manager",
  },
  {
    pattern: /secret\s*[=:]\s*['"][^'"]{10,}['"]/i,
    title: "Potential hardcoded secret",
    severity: "high",
    category: "Secrets",
    description: "Secrets should not be hardcoded in source code",
    recommendation: "Use environment variables or a secrets manager",
  },
  {
    pattern: /disable.*ssl|ssl.*false|verify.*false/i,
    title: "SSL verification disabled",
    severity: "high",
    category: "Transport Security",
    description: "Disabling SSL verification makes connections vulnerable to MITM attacks",
    recommendation: "Enable SSL verification in production",
  },
  {
    pattern: /cors\(\s*\)/,
    title: "CORS with default (permissive) settings",
    severity: "medium",
    category: "CORS",
    description: "Default CORS allows all origins",
    recommendation: "Configure specific allowed origins",
  },
  {
    pattern: /\.createReadStream\s*\([^)]*\+/,
    title: "Path traversal risk",
    severity: "high",
    category: "Path Traversal",
    description: "User input in file paths can lead to path traversal",
    recommendation: "Validate and sanitize file paths, use path.resolve()",
  },
];

/**
 * Auth pattern detection rules
 */
const AUTH_PATTERNS: Array<{
  pattern: RegExp;
  type: string;
  library?: string;
  description: string;
}> = [
  {
    pattern: /passport\.authenticate/,
    type: "Session-based (Passport.js)",
    library: "passport",
    description: "Uses Passport.js middleware for authentication",
  },
  {
    pattern: /jwt\.sign|jwt\.verify|jsonwebtoken/,
    type: "JWT",
    library: "jsonwebtoken",
    description: "Uses JSON Web Tokens for stateless auth",
  },
  {
    pattern: /NextAuth|getServerSession/,
    type: "NextAuth.js",
    library: "next-auth",
    description: "Uses NextAuth.js for Next.js authentication",
  },
  {
    pattern: /useAuth|AuthProvider|authContext/i,
    type: "Custom Auth Context",
    description: "Uses React context for auth state management",
  },
  {
    pattern: /OAuth2|oauth2Client/i,
    type: "OAuth2",
    description: "Implements OAuth2 authentication flow",
  },
  {
    pattern: /supabase\.auth/,
    type: "Supabase Auth",
    library: "@supabase/supabase-js",
    description: "Uses Supabase authentication",
  },
  {
    pattern: /firebase\.auth|getAuth\(\)/,
    type: "Firebase Auth",
    library: "firebase",
    description: "Uses Firebase authentication",
  },
  {
    pattern: /bcrypt\.hash|bcrypt\.compare|argon2\.hash/,
    type: "Password hashing",
    description: "Implements secure password hashing",
  },
  {
    pattern: /session\s*[=:]/i,
    type: "Session-based",
    description: "Uses session-based authentication",
  },
];

/**
 * Analyze a repository for security patterns and concerns
 */
export async function analyzeSecurityPatterns(
  repoPath: string,
  files: FileInfo[],
  packageJson?: Record<string, unknown>
): Promise<SecurityAnalysis> {
  const analysis: SecurityAnalysis = {
    score: 100,
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

  // Check dependencies for security packages
  if (packageJson) {
    const allDeps = {
      ...(packageJson.dependencies as Record<string, string> || {}),
      ...(packageJson.devDependencies as Record<string, string> || {}),
    };

    for (const [name, info] of Object.entries(SECURITY_PACKAGES)) {
      if (allDeps[name]) {
        analysis.securityDeps.push(info);

        // Update analysis flags
        if (info.type === "security-header" && name === "helmet") {
          analysis.headers.hasHelmet = true;
        }
        if (info.type === "security-header" && name === "cors") {
          analysis.headers.hasCors = true;
        }
        if (info.type === "rate-limit") {
          analysis.hasRateLimiting = true;
        }
        if (info.type === "validation") {
          analysis.hasInputValidation = true;
        }
      }
    }

    // Check for ORM (SQL injection prevention)
    const orms = ["prisma", "@prisma/client", "sequelize", "typeorm", "drizzle-orm", "knex"];
    if (orms.some(orm => allDeps[orm])) {
      analysis.hasSqlInjectionPrevention = true;
    }
  }

  // Check for env files and gitignore
  const fileNames = files.map(f => f.path);
  analysis.secretsHandling.envFiles = fileNames.filter(f => 
    /^\.env(\..+)?$/.test(basename(f)) && !f.includes(".example")
  );
  analysis.secretsHandling.hasEnvExample = fileNames.some(f => 
    f.includes(".env.example") || f.includes(".env.sample")
  );
  analysis.secretsHandling.configFiles = fileNames.filter(f =>
    /config\.(json|yaml|yml)$/i.test(f) && !f.includes("tsconfig")
  );

  // Check .gitignore for secrets patterns
  try {
    const gitignore = await readFile(join(repoPath, ".gitignore"), "utf-8");
    analysis.secretsHandling.gitignoreSecrets = 
      gitignore.includes(".env") || 
      gitignore.includes("*.pem") || 
      gitignore.includes("secrets");
  } catch {
    // No .gitignore
  }

  // Scan source files for security patterns and concerns
  const sourceFiles = files.filter(f => 
    !f.isDirectory && 
    /\.(ts|js|tsx|jsx|py|go|rs|java)$/.test(f.path) &&
    !f.path.includes("node_modules") &&
    !f.path.includes(".min.") &&
    f.size < 100000
  );

  const authPatternMap = new Map<string, AuthPattern>();

  for (const file of sourceFiles.slice(0, 50)) { // Limit scanning
    try {
      const content = await readFile(join(repoPath, file.path), "utf-8");

      // Check for auth patterns
      for (const { pattern, type, library, description } of AUTH_PATTERNS) {
        if (pattern.test(content)) {
          const existing = authPatternMap.get(type);
          if (existing) {
            existing.files.push(file.path);
          } else {
            authPatternMap.set(type, {
              type,
              library,
              files: [file.path],
              description,
            });
          }
        }
      }

      // Check for security concerns
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip comments and test files
        if (line.trim().startsWith("//") || line.trim().startsWith("#")) continue;
        if (file.path.includes(".test.") || file.path.includes(".spec.")) continue;

        for (const concern of CONCERN_PATTERNS) {
          if (concern.pattern.test(line)) {
            // Avoid duplicates
            const existingFinding = analysis.findings.find(f => 
              f.title === concern.title && f.file === file.path
            );
            if (!existingFinding) {
              analysis.findings.push({
                category: concern.category,
                title: concern.title,
                description: concern.description,
                severity: concern.severity,
                file: file.path,
                line: i + 1,
                recommendation: concern.recommendation,
              });
            }
          }
        }
      }

      // Check for CSP
      if (/Content-Security-Policy|contentSecurityPolicy/i.test(content)) {
        analysis.headers.hasCSP = true;
      }

    } catch {
      // Skip unreadable files
    }
  }

  analysis.authPatterns = Array.from(authPatternMap.values());

  // Calculate security score
  analysis.score = calculateSecurityScore(analysis);

  return analysis;
}

/**
 * Calculate a security score based on findings
 */
function calculateSecurityScore(analysis: SecurityAnalysis): number {
  let score = 100;

  // Deduct for findings by severity
  for (const finding of analysis.findings) {
    switch (finding.severity) {
      case "critical": score -= 15; break;
      case "high": score -= 10; break;
      case "medium": score -= 5; break;
      case "low": score -= 2; break;
      // info doesn't affect score
    }
  }

  // Bonus for security measures
  if (analysis.headers.hasHelmet) score += 5;
  if (analysis.headers.hasCors) score += 2;
  if (analysis.headers.hasCSP) score += 5;
  if (analysis.hasRateLimiting) score += 5;
  if (analysis.hasInputValidation) score += 5;
  if (analysis.hasSqlInjectionPrevention) score += 5;
  if (analysis.secretsHandling.gitignoreSecrets) score += 3;
  if (analysis.secretsHandling.hasEnvExample) score += 2;

  // Deduct if no auth security deps but has auth patterns
  if (analysis.authPatterns.length > 0 && 
      !analysis.securityDeps.some(d => d.type === "crypto")) {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Get a letter grade from score
 */
export function getSecurityGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Generate security documentation
 */
export function generateSecurityDocs(analysis: SecurityAnalysis, projectName: string): string {
  const lines: string[] = [];
  const grade = getSecurityGrade(analysis.score);

  lines.push("# Security Overview");
  lines.push("");
  lines.push(`Security analysis for **${projectName}**.`);
  lines.push("");

  // Score badge
  lines.push("## Security Score");
  lines.push("");
  const scoreColor = analysis.score >= 80 ? "🟢" : analysis.score >= 60 ? "🟡" : "🔴";
  lines.push(`${scoreColor} **${analysis.score}/100** (Grade: ${grade})`);
  lines.push("");

  // Security measures in place
  lines.push("## Security Measures");
  lines.push("");
  
  const measures: string[] = [];
  if (analysis.headers.hasHelmet) measures.push("✅ Security headers (Helmet)");
  else measures.push("⚠️ No security headers middleware detected");
  
  if (analysis.headers.hasCors) measures.push("✅ CORS configured");
  if (analysis.headers.hasCSP) measures.push("✅ Content Security Policy");
  if (analysis.hasRateLimiting) measures.push("✅ Rate limiting");
  else measures.push("⚠️ No rate limiting detected");
  
  if (analysis.hasInputValidation) measures.push("✅ Input validation");
  else measures.push("⚠️ No validation library detected");
  
  if (analysis.hasSqlInjectionPrevention) measures.push("✅ SQL injection prevention (ORM)");
  if (analysis.secretsHandling.gitignoreSecrets) measures.push("✅ Secrets excluded from git");
  if (analysis.secretsHandling.hasEnvExample) measures.push("✅ Environment example file provided");

  lines.push(measures.join("\n"));
  lines.push("");

  // Auth patterns
  if (analysis.authPatterns.length > 0) {
    lines.push("## Authentication");
    lines.push("");
    for (const auth of analysis.authPatterns) {
      lines.push(`### ${auth.type}`);
      lines.push("");
      lines.push(auth.description);
      if (auth.library) {
        lines.push(`- **Library:** \`${auth.library}\``);
      }
      lines.push(`- **Files:** ${auth.files.slice(0, 5).map(f => `\`${f}\``).join(", ")}`);
      lines.push("");
    }
  }

  // Security dependencies
  if (analysis.securityDeps.length > 0) {
    lines.push("## Security Dependencies");
    lines.push("");
    lines.push("| Package | Purpose | Type |");
    lines.push("|---------|---------|------|");
    for (const dep of analysis.securityDeps) {
      lines.push(`| ${dep.name} | ${dep.purpose} | ${dep.type} |`);
    }
    lines.push("");
  }

  // Findings
  const criticalFindings = analysis.findings.filter(f => f.severity === "critical");
  const highFindings = analysis.findings.filter(f => f.severity === "high");
  const mediumFindings = analysis.findings.filter(f => f.severity === "medium");
  const otherFindings = analysis.findings.filter(f => f.severity === "low" || f.severity === "info");

  if (analysis.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");

    if (criticalFindings.length > 0) {
      lines.push("### 🔴 Critical");
      lines.push("");
      for (const finding of criticalFindings) {
        lines.push(`#### ${finding.title}`);
        lines.push("");
        lines.push(`- **File:** \`${finding.file}:${finding.line}\``);
        lines.push(`- **Issue:** ${finding.description}`);
        lines.push(`- **Recommendation:** ${finding.recommendation}`);
        lines.push("");
      }
    }

    if (highFindings.length > 0) {
      lines.push("### 🟠 High");
      lines.push("");
      for (const finding of highFindings) {
        lines.push(`#### ${finding.title}`);
        lines.push("");
        lines.push(`- **File:** \`${finding.file}:${finding.line}\``);
        lines.push(`- **Issue:** ${finding.description}`);
        lines.push(`- **Recommendation:** ${finding.recommendation}`);
        lines.push("");
      }
    }

    if (mediumFindings.length > 0) {
      lines.push("### 🟡 Medium");
      lines.push("");
      for (const finding of mediumFindings.slice(0, 10)) {
        lines.push(`- **${finding.title}** in \`${finding.file}:${finding.line}\``);
        lines.push(`  - ${finding.recommendation}`);
      }
      if (mediumFindings.length > 10) {
        lines.push(`- ... and ${mediumFindings.length - 10} more`);
      }
      lines.push("");
    }

    if (otherFindings.length > 0) {
      lines.push("### ℹ️ Informational");
      lines.push("");
      lines.push(`${otherFindings.length} informational findings (not shown).`);
      lines.push("");
    }
  } else {
    lines.push("## Findings");
    lines.push("");
    lines.push("✅ No security concerns detected in the scanned files.");
    lines.push("");
  }

  // Secrets handling
  lines.push("## Secrets Handling");
  lines.push("");
  if (analysis.secretsHandling.envFiles.length > 0) {
    lines.push(`**Environment files found:** ${analysis.secretsHandling.envFiles.join(", ")}`);
    lines.push("");
    if (!analysis.secretsHandling.gitignoreSecrets) {
      lines.push("⚠️ **Warning:** Ensure `.env` files are in `.gitignore`");
    }
  } else {
    lines.push("No environment files detected in repository.");
  }
  lines.push("");

  // Recommendations
  lines.push("## Recommendations");
  lines.push("");
  
  const recs: string[] = [];
  if (!analysis.headers.hasHelmet) {
    recs.push("- Add `helmet` middleware for security headers");
  }
  if (!analysis.hasRateLimiting) {
    recs.push("- Implement rate limiting for API endpoints");
  }
  if (!analysis.hasInputValidation) {
    recs.push("- Add input validation using `zod`, `joi`, or similar");
  }
  if (!analysis.secretsHandling.hasEnvExample) {
    recs.push("- Create `.env.example` to document required environment variables");
  }
  if (criticalFindings.length > 0) {
    recs.push("- **Priority:** Address critical security findings immediately");
  }

  if (recs.length > 0) {
    lines.push(recs.join("\n"));
  } else {
    lines.push("✅ No major recommendations - security posture looks good!");
  }
  lines.push("");

  return lines.join("\n");
}
