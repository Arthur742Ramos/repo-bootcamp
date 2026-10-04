import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  htmlTables,
  ownedProcess,
  requirementCli,
  requirementExport,
  requirementFixture,
} from "./root-requirement-lines.js";

export { htmlTables, ownedProcess };
export interface LocalReferenceConfig {
  mixed: boolean;
  pyproject?: boolean;
  capped?: boolean;
}
export const localReferenceConfigurations: LocalReferenceConfig[] = [
  { mixed: false },
  { mixed: true },
  { mixed: true, pyproject: true },
  { mixed: true, capped: true },
];
// All archive suffixes recognized by pip; these are lexical negatives, not
// claims that every compression format is produced by this fixture builder.
// https://github.com/pypa/pip/blob/main/src/pip/_internal/utils/filetypes.py
export const pipArchiveSuffixes = [
  ".zip",
  ".whl",
  ".tar.bz2",
  ".tbz",
  ".tar.gz",
  ".tgz",
  ".tar",
  ".tar.xz",
  ".txz",
  ".tlz",
  ".tar.lz",
  ".tar.lzma",
];
export const lexicalArchives = pipArchiveSuffixes.map(
  (suffix, index) => `archive-${index}${suffix}`
);
export const admittedRootRows = [
  ["requests", "2.31"],
  ["legitimate.tar.gz", "2.0"],
  ["c", "3"],
  ["c", "*"],
  ["plain-project", "*"],
  ["plain-project", "4"],
  ["foo.whl", "*"],
  ["foo.tar.gz", "*"],
  ["slash-version", "lane/1"],
  ["backslash-version", "lane\\2"],
  ["parenthesized", "(>=1/<2)"],
  ["parenthesized-backslash", "(>=lane\\3)"],
  ["named-relative", "@ owned/local"],
  ["named-backslash", "@ owned\\local"],
  ["named-file", "@ file:owned/local"],
  ["named-wheel", "@ owned-1.0-py3-none-any.whl"],
  ["duplicate", "1"],
  ["duplicate", "2"],
  ["range", "2,<3"],
  ["envliteral", "${OWNED_ROOT_VERSION}"],
];
const pyprojectRows = [
  ["pyproject-control", ">=11"],
  ["legitimate.tar.gz", "==12"],
  ["named-relative", "@ owned/local"],
];
export const rejectedLocalNames = [
  "owned",
  "C",
  "file",
  "relative-owned",
  "owned-1.0-py3-none-any.whl",
  "owned-source-1.0.tar.gz",
  "feature.whl",
  "feature.tar.gz",
  "ARCHIVE-UPPER.TAR.GZ",
  "ignored-requirements.txt",
  "outside_scope_package",
  "outside_parent_package",
  "constraint_scope_package",
  "owned-local-origin",
  "local-origin-dependency",
  "named-remote",
  ...lexicalArchives,
];
const filler = (kind: string, length: number) =>
  Array.from({ length }, (_, index) => [
    `${kind}-fill-${String(index).padStart(2, "0")}`,
    `^${index + 10}.0.0`,
  ]);
function nodeRows(config: LocalReferenceConfig) {
  return {
    runtime: [
      ["node-local", "file:owned/local"],
      ["node-archive.whl", "file:owned-1.0-py3-none-any.whl"],
    ],
    dev: [["node-dev", "^1"], ...(config.capped ? filler("dev", 32) : [])],
    peer: [["node-peer", "^3"], ...(config.capped ? filler("peer", 32) : [])],
  };
}
export function expectedLocalInventory(config: LocalReferenceConfig) {
  const record = (
    row: string[],
    type: "runtime" | "dev" | "peer",
    ecosystem: string,
    sourceFile: string
  ) => ({
    name: row[0],
    version: row[1],
    type,
    ...(config.mixed ? { ecosystem, sourceFile } : {}),
  });
  const python = config.pyproject
    ? pyprojectRows
    : [...admittedRootRows, ...(config.capped ? filler("runtime", 55) : [])];
  const node = nodeRows(config);
  return {
    runtime: [
      ...(config.mixed
        ? [
            ...node.runtime.map((row) => record(row, "runtime", "node", "package.json")),
            record(["cargo-local", "4.0"], "runtime", "rust", "Cargo.toml"),
            record(["cargo-path-only", "*"], "runtime", "rust", "Cargo.toml"),
          ]
        : []),
      ...python.map((row) =>
        record(row, "runtime", "python", config.pyproject ? "pyproject.toml" : "requirements.txt")
      ),
      ...(config.mixed
        ? [record(["example.invalid/owned/local", "v6.0.0"], "runtime", "go", "go.mod")]
        : []),
    ],
    dev: config.mixed
      ? [
          ...node.dev.map((row) => record(row, "dev", "node", "package.json")),
          record(["cargo-dev", "2.0"], "dev", "rust", "Cargo.toml"),
        ]
      : [],
    peer: config.mixed ? node.peer.map((row) => record(row, "peer", "node", "package.json")) : [],
  };
}
export function expectedLocalTables(config: LocalReferenceConfig, markdown = false) {
  const inventory = expectedLocalInventory(config);
  return (["runtime", "dev", "peer"] as const)
    .filter((kind) => inventory[kind].length && (kind !== "peer" || config.mixed))
    .map((kind) => {
      const cap = kind === "runtime" ? 50 : 30;
      const rows = inventory[kind]
        .slice(0, cap)
        .map((dep) => [
          dep.name,
          markdown && /[\\_]/.test(dep.version) ? "`" + dep.version + "`" : dep.version,
          ...(config.mixed ? [dep.ecosystem!, dep.sourceFile!] : []),
        ]);
      if (inventory[kind].length > cap)
        rows.push([
          "...",
          `+${inventory[kind].length - cap} more`,
          ...(config.mixed ? ["", ""] : []),
        ]);
      return {
        kind,
        headers: config.mixed
          ? ["Package", "Version", "Ecosystem", "Manifest"]
          : ["Package", "Version"],
        rows,
      };
    });
}

// A minimal stored ZIP with CRCs and a central directory. The wheel contains
// package code, METADATA, WHEEL and RECORD, with no install or archive extraction.
function storedZip(files: [string, string][]): Buffer {
  const crc32 = (bytes: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [filename, content] of files) {
    const name = Buffer.from(filename);
    const data = Buffer.from(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x21, 12); // 1980-01-01, deterministic DOS date
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(entry, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function sourceTarGzip(files: [string, string][]): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(0x20, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
const projectToml =
  '[build-system]\nrequires=["setuptools>=61"]\nbuild-backend="setuptools.build_meta"\n[project]\nname="owned-local-origin"\nversion="1.0.0"\ndependencies=["local-origin-dependency==97"]\n[tool.setuptools]\npy-modules=["owned_local"]\n';
async function installableDirectory(path: string) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "pyproject.toml"), projectToml);
  await writeFile(join(path, "owned_local.py"), "metadata_only = True\n");
}

export async function localReferenceFixture(config: LocalReferenceConfig, git = false) {
  const owned = await requirementFixture({ mixed: false, ending: "\n" }, "");
  const directories = [
    join(owned.repo, "owned", "local"),
    join(owned.repo, "relative-owned"),
    join(owned.repo, "plain-project"),
    join(owned.base, "outside-owned"),
  ];
  for (const directory of directories) await installableDirectory(directory);
  const windowsOrigin = join(owned.repo, "windows-owned");
  if (process.platform === "win32") await installableDirectory(windowsOrigin);
  const wheelFiles: [string, string][] = [
    ["owned_local.py", "metadata_only = True\n"],
    ["owned-1.0.dist-info/METADATA", "Metadata-Version: 2.1\nName: owned\nVersion: 1.0\n\n"],
    [
      "owned-1.0.dist-info/WHEEL",
      "Wheel-Version: 1.0\nGenerator: owned-fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n\n",
    ],
  ];
  const recordName = "owned-1.0.dist-info/RECORD";
  wheelFiles.push([
    recordName,
    [
      ...wheelFiles.map(
        ([name, content]) =>
          `${name},sha256=${createHash("sha256").update(content).digest("base64url")},${Buffer.byteLength(content)}`
      ),
      `${recordName},,`,
      "",
    ].join("\n"),
  ]);
  const wheel = join(owned.repo, "owned-1.0-py3-none-any.whl");
  const source = join(owned.repo, "owned-source-1.0.tar.gz");
  await writeFile(wheel, storedZip(wheelFiles));
  await writeFile(
    source,
    sourceTarGzip([
      ["owned-source-1.0/pyproject.toml", projectToml],
      ["owned-source-1.0/owned_local.py", "metadata_only = True\n"],
      [
        "owned-source-1.0/PKG-INFO",
        "Metadata-Version: 2.1\nName: owned-local-origin\nVersion: 1.0.0\n\n",
      ],
    ])
  );
  const text =
    [
      "# Owned root local references. No origins/includes are processed.",
      "-r ignored-requirements.txt",
      "-r ../outside-requirements.txt",
      "-c owned-constraints.txt",
      "--find-links owned/local",
      "owned/local",
      "owned\\local",
      "owned/local[feature]",
      "relative-owned/",
      "./owned/local",
      "../outside-owned",
      directories[0],
      "file:owned/local",
      "C:\\owned\\local", // Lexical drive-string negative on non-Windows.
      "\\\\server\\owned\\local", // Lexical UNC negative; never traversed.
      ...(process.platform === "win32" ? [windowsOrigin] : []),
      "owned-1.0-py3-none-any.whl",
      "owned-source-1.0.tar.gz",
      ...lexicalArchives,
      "ARCHIVE-UPPER.TAR.GZ",
      "feature.whl[feature]",
      "feature.tar.gz [ feature ]",
      "requests==2.31 # https://example.invalid/comment.whl",
      "legitimate.tar.gz==2.0",
      "c==3",
      "c",
      "plain-project",
      "plain-project==4",
      // Empty [] is not stripped by pip's strip_extras: keep plain-name controls.
      "foo.whl[]",
      "foo.tar.gz[]",
      // Descriptive compatibility literals, not resolved/validated PEP versions.
      "slash-version==lane/1",
      "backslash-version>=lane\\2",
      "parenthesized (>=1/<2)",
      "parenthesized-backslash (>=lane\\3)",
      "named-relative [ feature ] @ owned/local",
      "named-backslash @ owned\\local",
      "named-file @ file:owned/local",
      "named-wheel @ owned-1.0-py3-none-any.whl",
      "named-remote @ https://example.invalid/remote.whl",
      "duplicate==1",
      "duplicate>=2",
      "range>=2,<3",
      "envliteral==${OWNED_ROOT_VERSION}",
      ...(config.capped
        ? filler("runtime", 55).map(([name, version]) => `${name}==${version}`)
        : []),
    ].join("\n") + "\n";
  await writeFile(join(owned.repo, "requirements.txt"), text);
  if (config.pyproject)
    await writeFile(
      join(owned.repo, "pyproject.toml"),
      '[project]\nname="owned-priority"\nversion="1.0.0"\ndependencies=["pyproject-control>=11","legitimate.tar.gz==12","named-relative @ owned/local"]\n'
    );
  if (config.mixed) {
    const node = nodeRows(config);
    await writeFile(
      join(owned.repo, "package.json"),
      JSON.stringify({
        name: "owned-sidecar",
        dependencies: Object.fromEntries(node.runtime),
        devDependencies: Object.fromEntries(node.dev),
        peerDependencies: Object.fromEntries(node.peer),
      })
    );
    await writeFile(
      join(owned.repo, "Cargo.toml"),
      '[package]\nname="owned-rust"\nversion="1.0.0"\n[dependencies]\ncargo-local={path="owned/local",version="4.0"}\ncargo-path-only={path="owned/local"}\n[dev-dependencies]\ncargo-dev="2.0"\n'
    );
    await writeFile(
      join(owned.repo, "go.mod"),
      "module example.invalid/fixture\ngo 1.22\nrequire example.invalid/owned/local v6.0.0\n"
    );
  }
  // Instrument only the standalone deps child. Export ingestion may scan
  // source files normally, but root dependency admission must never open,
  // stat, enumerate or test existence of any reference origin or include.
  const originFiles = [
    wheel,
    source,
    join(owned.repo, "ignored-requirements.txt"),
    join(owned.base, "outside-requirements.txt"),
    join(owned.repo, "owned-constraints.txt"),
  ];
  const protectedOrigins = [
    ...directories,
    ...originFiles,
    ...lexicalArchives.map((name) => join(owned.repo, name)),
    join(owned.repo, "feature.whl"),
    join(owned.repo, "feature.tar.gz"),
    join(owned.repo, "ARCHIVE-UPPER.TAR.GZ"),
    ...(process.platform === "win32" ? [windowsOrigin] : []),
  ];
  await writeFile(
    owned.preload,
    (await readFile(owned.preload, "utf8")) +
      `
import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
if(process.argv[2]==='deps'){
 const origins=${JSON.stringify(protectedOrigins)}.map(p=>path.resolve(p));
 const append=fs.appendFileSync;const log=path.join(os.homedir(),'origin-access.jsonl');
 const check=(value,method)=>{if(typeof value!=='string'&&!(value instanceof URL))return;const p=path.resolve(value instanceof URL?fileURLToPath(value):value);if(origins.some(o=>p===o||p.startsWith(o+path.sep))){append(log,JSON.stringify({method,path:p})+'\\n');throw new Error('Owned root reference origin accessed: '+method);}};
 for(const method of ['readFile','open','stat','lstat','access','readdir','opendir','realpath']){const original=fsp[method];fsp[method]=async function(value,...args){check(value,method);return original.call(this,value,...args);};}
 for(const method of ['readFileSync','openSync','statSync','lstatSync','accessSync','existsSync','readdirSync','opendirSync','realpathSync']){const original=fs[method];const wrapped=function(value,...args){check(value,method);return original.call(this,value,...args);};if(original.native)wrapped.native=function(value,...args){check(value,method+'.native');return original.native.call(this,value,...args);};fs[method]=wrapped;}
 syncBuiltinESMExports();
}
`
  );
  if (git) {
    const env = {
      PATH: process.env.PATH,
      HOME: owned.base,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const command = (...args: string[]) =>
      execFileSync("git", args, { cwd: owned.repo, env, stdio: "ignore" });
    command("init", "-b", "main");
    command("add", ".");
    command(
      "-c",
      "user.name=Owned Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "Owned local reference fixtures"
    );
  }
  const untouched = await Promise.all(
    [
      join(owned.repo, "requirements.txt"),
      ...originFiles,
      ...directories.map((directory) => join(directory, "pyproject.toml")),
      ...(process.platform === "win32" ? [join(windowsOrigin, "pyproject.toml")] : []),
    ].map(async (path) => ({ path, bytes: await readFile(path) }))
  );
  return {
    ...owned,
    config,
    untouched,
    wheel,
    source,
    protectedOrigins,
    windowsOrigin,
    windowsMode:
      process.platform === "win32"
        ? "actual owned Windows drive path"
        : "lexical Windows drive-string negative",
  };
}
export const localReferenceCli = requirementCli;
export const localReferenceExport = requirementExport;
export async function localReferenceDocuments(config: LocalReferenceConfig) {
  const owned = await localReferenceFixture(config);
  try {
    return {
      html: (await localReferenceExport(owned, "html")).doc,
      pdf: (await localReferenceExport(owned, "pdf")).doc,
    };
  } finally {
    await rm(owned.base, { recursive: true, force: true });
  }
}
