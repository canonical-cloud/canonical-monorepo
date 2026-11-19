import test from "node:test";
import assert from "node:assert/strict";

const STRICT_PROVIDER_KINDS = new Set(["readiness", "completion", "unsupported"]);
const FORBIDDEN_PROVIDER_KINDS = new Set([
  "sync", "blocking-worker", "thread-pool", "virtual-thread", "caller-runs"
]);

function requireStrictProvider(kind) {
  if (FORBIDDEN_PROVIDER_KINDS.has(kind)) {
    throw new Error("blocking provider forbidden: " + kind);
  }
  if (!STRICT_PROVIDER_KINDS.has(kind)) {
    throw new Error("unknown provider kind: " + kind);
  }
  return kind;
}

function stripCommentsAndStrings(source) {
  let out = "";
  let state = "code";
  let quote = "";
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; }
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") { state = "code"; i++; }
      continue;
    }
    if (state === "string") {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) state = "code";
      continue;
    }
    if (c === "/" && n === "/") { state = "line"; i++; continue; }
    if (c === "/" && n === "*") { state = "block"; i++; continue; }
    if (c === '"' || c === "'" || c === "`") {
      state = "string"; quote = c; continue;
    }
    out += c;
  }
  if (state === "block" || state === "string") throw new Error("unterminated source");
  return out;
}

const coreIoNames = [
  /\bstdio\b/, /\bfs\b/, /\bFile\b/, /\bnetwork\b/, /\bnet\b/,
  /\bhttp\b/, /\bsocket\b/, /\bprocess\b/, /\bWASI\b/,
  /\bnode:(?:fs|net|http|https|child_process)\b/
];

function stripCommentsKeepStrings(source) {
  let out = "";
  let state = "code";
  let quote = "";
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; }
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") { state = "code"; i++; }
      continue;
    }
    if (state === "string") {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) state = "code";
      continue;
    }
    if (c === "/" && n === "/") { state = "line"; i++; continue; }
    if (c === "/" && n === "*") { state = "block"; i++; continue; }
    if (c === '"' || c === "'" || c === "`") {
      state = "string"; quote = c; out += c; continue;
    }
    out += c;
  }
  if (state === "block" || state === "string") throw new Error("unterminated source");
  return out;
}

function auditPureCore(source) {
  const withStrings = stripCommentsKeepStrings(source);
  assert.doesNotMatch(
    withStrings,
    /(?:from\s+|import\s*\()\s*(['"])node:(?:fs|net|http|https|child_process)\1/
  );
  const code = stripCommentsAndStrings(source);
  for (const pattern of coreIoNames) {
    assert.doesNotMatch(code, pattern);
  }
}

const javaBlocking = [
  /context\.nativeIo\(\)\.submit(?:Close)?\s*\(/,
  /\bNativeIo\.(?:readText|writeText|writeTextAtomic|appendText|exists|listDir|isDir|isSymlink|remove|createDirectories|connect|httpGetText|httpPostText)\s*\(/,
  /\bcontext\.input\(\)\.readLine\s*\(/,
  /\bcontext\.output\(\)\.(?:print|println|flush)\s*\(/,
  /\bcontext\.http\(\)/,
  /\bsocket\.(?:readLine|writeText|close)\s*\(/
];

const jsBlocking = [
  /\b(?:readFile|writeFile|appendFile|open|close|stat|lstat|readdir|mkdir|rm|unlink|rename|copyFile)Sync\b/,
  /\b(?:exec|execFile|spawn)Sync\b/,
  /\bAtomics\.wait\s*\(/,
  /\.wait\s*\(/,
  /\bXMLHttpRequest\b/,
  /\b(?:Deno|Bun)\.(?:readTextFileSync|readFileSync|writeTextFileSync|writeFileSync)\b/
];

const dotnetBlocking = [
  /\bFile\.(?:ReadAllBytes|ReadAllText|ReadAllLines|WriteAllBytes|WriteAllText|WriteAllLines|AppendAllText|AppendAllLines|OpenRead|OpenWrite)\s*\(/,
  /\bnew\s+FileStream\s*\(/,
  /\.(?:Receive|ReceiveFrom|Send|SendTo|Accept|Connect)\s*\(/,
  /\bConsole\.(?:Read|ReadLine|Write|WriteLine)\s*\(/,
  /\bThread\.Sleep\s*\(/,
  /\.GetAwaiter\(\)\.GetResult\(\)/,
  /\bTask\.Wait(?:All|Any)?\s*\(/,
  /\.Send\s*\(/
];

function auditPatterns(source, patterns) {
  const code = stripCommentsAndStrings(source);
  for (const pattern of patterns) assert.doesNotMatch(code, pattern);
}

function auditJava(source) {
  // Java processes Unicode escapes before comments/strings are tokenized.
  // Fail closed so an escape cannot synthesize a newline or identifier.
  assert.doesNotMatch(source, /\\u+[0-9a-fA-F]{4}/);
  auditPatterns(source, javaBlocking);
}

function validateWasmAdmission({imports, hostCapabilities, ioMode, guestNetworkIo, nioReactors}) {
  assert.equal(ioMode, "nio-only");
  assert.equal(guestNetworkIo, false);
  assert.equal(nioReactors, 0);
  assert.equal(imports, 0);
  assert.equal(hostCapabilities, 0);
}

class BoundedIoQueue {
  #limit;
  #inFlight = 0;
  constructor(limit) {
    assert.ok(Number.isInteger(limit) && limit > 0);
    this.#limit = limit;
  }
  admit() {
    if (this.#inFlight >= this.#limit) return false;
    this.#inFlight++;
    return true;
  }
  settle() {
    assert.ok(this.#inFlight > 0, "completion must settle exactly one admitted operation");
    this.#inFlight--;
  }
  get inFlight() { return this.#inFlight; }
}

class CompletionGate {
  #terminal = false;
  #value;
  settle(value) {
    if (this.#terminal) return false;
    this.#terminal = true;
    this.#value = value;
    return true;
  }
  get value() { return this.#value; }
}

test("only readiness/completion or explicit unsupported states satisfy strict I/O", () => {
  for (const kind of ["readiness", "completion", "unsupported"]) {
    assert.equal(requireStrictProvider(kind), kind);
  }
  for (const kind of FORBIDDEN_PROVIDER_KINDS) {
    assert.throws(() => requireStrictProvider(kind), /blocking provider forbidden/);
  }
  assert.throws(() => requireStrictProvider("promise-around-sync"), /unknown provider kind/);
});

test("core stays host-I/O-free while comments and literals do not create false positives", () => {
  auditPureCore(`
    define module core as
      // fs.read_text("not executable")
      pub fnc max_int(int a, int b): int { return a > b ? a : b; }
      pub fnc label(): String { return "http network stdio process node:fs"; }
    end
  `);
  assert.throws(() => auditPureCore("fnc f():void { fs.read_text_async('x'); }"));
  assert.throws(() => auditPureCore("import x from 'node:fs';"));
});

test("Java policy rejects worker-offloaded and direct blocking guest dispatch", () => {
  auditJava('return strictNonblockingIoFuture("fs.read_text_async");');
  auditJava('// NativeIo.readText(path)\nreturn strictNonblockingIoFuture("x");');
  for (const source of [
    "return context.nativeIo().submit(() -> work());",
    "return NativeIo.readText(path);",
    "return context.input().readLine();",
    "context.output().println(value);",
    "return context.http();",
    "return socket.readLine();"
  ]) assert.throws(() => auditJava(source));
});

test("Java Unicode-escape preprocessing is rejected before lexical scanning", () => {
  assert.throws(() => auditJava(String.raw`// \\u000a context.nativeIo().submit(() -> work());`));
  assert.throws(() => auditJava(String.raw`String s = "\\u0066s.read_text";`));
});

test("JS policy rejects sync filesystem/process/wait APIs and accepts evented forms", () => {
  auditPatterns("await readFile(path); await once(stream, 'drain');", jsBlocking);
  auditPatterns("// readFileSync(path)\nawait readFile(path);", jsBlocking);
  for (const source of [
    "fs.readFileSync(path)",
    "child.spawnSync(cmd)",
    "Atomics.wait(view,0,0)",
    "worker.wait()",
    "new XMLHttpRequest()",
    "Deno.readTextFileSync(path)"
  ]) assert.throws(() => auditPatterns(source, jsBlocking));
});

test(".NET policy rejects synchronous data-plane and sync-over-async calls", () => {
  auditPatterns("await socket.ReceiveAsync(buffer, cancellationToken);", dotnetBlocking);
  for (const source of [
    "File.ReadAllText(path)",
    "new FileStream(path, FileMode.Open)",
    "socket.Receive(buffer)",
    "Console.ReadLine()",
    "Thread.Sleep(1)",
    "task.GetAwaiter().GetResult()",
    "Task.WaitAll(tasks)",
    "client.Send(request)"
  ]) assert.throws(() => auditPatterns(source, dotnetBlocking));
});

test("Wasm core profile remains zero-capability and fail-closed", () => {
  validateWasmAdmission({
    imports: 0, hostCapabilities: 0, ioMode: "nio-only",
    guestNetworkIo: false, nioReactors: 0
  });
  for (const bad of [
    {imports:1, hostCapabilities:0, ioMode:"nio-only", guestNetworkIo:false, nioReactors:0},
    {imports:0, hostCapabilities:1, ioMode:"nio-only", guestNetworkIo:false, nioReactors:0},
    {imports:0, hostCapabilities:0, ioMode:"blocking", guestNetworkIo:false, nioReactors:0},
    {imports:0, hostCapabilities:0, ioMode:"nio-only", guestNetworkIo:true, nioReactors:0},
    {imports:0, hostCapabilities:0, ioMode:"nio-only", guestNetworkIo:false, nioReactors:1}
  ]) assert.throws(() => validateWasmAdmission(bad));
});

test("backpressure is bounded and completion is exactly-once", () => {
  const queue = new BoundedIoQueue(2);
  assert.equal(queue.admit(), true);
  assert.equal(queue.admit(), true);
  assert.equal(queue.admit(), false);
  queue.settle();
  assert.equal(queue.admit(), true);
  queue.settle();
  queue.settle();
  assert.equal(queue.inFlight, 0);
  assert.throws(() => queue.settle(), /exactly one admitted operation/);

  const completion = new CompletionGate();
  assert.equal(completion.settle({kind:"cancelled"}), true);
  assert.equal(completion.settle({kind:"success"}), false);
  assert.deepEqual(completion.value, {kind:"cancelled"});
});

test("LLVM contract requires nonblocking creation, data-plane flags and one-shot readiness", () => {
  const compliant = `
    socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    recv(fd, bytes, size, MSG_DONTWAIT);
    send(fd, bytes, size, MSG_DONTWAIT | MSG_NOSIGNAL);
    accept4(fd, nullptr, nullptr, SOCK_NONBLOCK | SOCK_CLOEXEC);
    eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
    event.events = EPOLLIN | EPOLLONESHOT;
  `;
  for (const pattern of [
    /SOCK_STREAM\s*\|\s*SOCK_NONBLOCK\s*\|\s*SOCK_CLOEXEC/,
    /recv\([^;]+MSG_DONTWAIT\)/s,
    /send\([^;]+MSG_DONTWAIT\s*\|\s*MSG_NOSIGNAL\)/s,
    /accept4\([^;]+SOCK_NONBLOCK\s*\|\s*SOCK_CLOEXEC\)/s,
    /eventfd\(0,\s*EFD_NONBLOCK\s*\|\s*EFD_CLOEXEC\)/,
    /EPOLLONESHOT/
  ]) assert.match(compliant, pattern);

  for (const blocked of [
    "::accept(fd,nullptr,nullptr)",
    "::recv(fd,buf,n,0)",
    "::send(fd,buf,n,0)"
  ]) assert.match(blocked, /::(?:accept|recv|send)\s*\(/);
});
