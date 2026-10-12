## Exact-byte compiler and source admission

The standalone `.ores` bridge must compile and execute **the bytes it hashes**.
`sourceSha256` names the staged source snapshot, not a mutable caller-owned
pathname. `compilerSha256` names the staged executable actually invoked,
not merely an executable read earlier before running a different path.

The bridge writes both verified inputs into a freshly-created private scratch
directory. It executes the staged compiler with the staged source path, then
checks both still match their original hashes before publishing metadata or
Wasm. A compiler that mutates its original path does not change the executable
that was launched. A compiler that modifies its staged inputs is rejected.
The artifact sidecars are published before the Wasm binary, and consumers
must check their SHA-256 identities because separate filesystem renames are
not a single atomic transaction.

This guard only proves byte identity for **standalone source and executable
files**. It is not a general sandbox or signed source-to-binary attestation.
Native dynamic libraries, compiler plugins, subprocesses, relative imports,
script dependencies, external toolchains, and environment variables are not
included in the compiler-byte hash. Production module-graph closure and
toolchain attestation require separate policy. The staged executable must be
self-contained or have explicitly verified external dependencies.

Run the adversarial source mutation, executable snapshot, staged mutation,
output-path alias, sidecar publication, real Clang, and full package tests
before merge.

## Filesystem alias and size admission

The bridge resolves the output's parent directory to a physical path and
compares its final executable and sidecar destinations with the physical
compiler and source inputs. Existing output/sidecar filesystem objects are
also checked by device/inode, so direct paths, symlinked parents, symlinked
destinations, and hardlinked destinations cannot overwrite build inputs.

Only regular source and compiler files are accepted; static admission rejects
sources larger than 1 MiB and compiler executables larger than 256 MiB before
a full file read. A generated Wasm artifact larger than 16 MiB is rejected
before reading, validating, or publishing it. Post-read checks also enforce
those size limits. The source/compiler files and output directory still
require trusted ownership: path checks are not an atomic defense against a
malicious same-user filesystem actor changing directories after verification.

The publication regressions use an executable compiler stand-in; a malformed
fixture that aborts before the intended publication stage does not count as
negative-test coverage.
