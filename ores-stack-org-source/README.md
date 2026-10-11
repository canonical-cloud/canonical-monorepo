# ORES Stack organization configuration

This repository contains GitHub organization configuration and documentation for **[ORES Stack](https://github.com/ores-stack)**. It is **not** the Oreslang Stack project, and this repository is not an Oreslang compiler or application-stack CLI.

## Two separate projects

| | ORES Stack | Oreslang Stack |
| --- | --- | --- |
| GitHub home | [`ores-stack`](https://github.com/ores-stack) | [`ores-truffle-oreslang`](https://github.com/ores-truffle-oreslang) |
| CLI repository | [`ores-stack/ores-stack-cli`](https://github.com/ores-stack/ores-stack-cli) | [`ores-truffle-oreslang/oreslang-stack-cli`](https://github.com/ores-truffle-oreslang/oreslang-stack-cli) |
| Command | `ores-stack` | `oreslang-stack` |
| Implementation | Rust/Cargo CLI and associated ORES Stack contracts | Oreslang `src/main.ores` command logic, POSIX bootstrap, Java/Graal Oreslang runtime |
| Purpose | ORES Stack modules, RPC/Lambda adapters, WASM build and runtime/provider deployment flows | Oreslang-native scaffolding, route discovery, source generation, compiler checks and packaging |

The similarly named CLIs are **not aliases, substitutions, or shared release artifacts**. Keep their manifests, binaries, generated output, CI gates, and ownership separate. ORES Stack's migration status is documented in [`ores-stack-cli/MIGRATION.md`](https://github.com/ores-stack/ores-stack-cli/blob/main/MIGRATION.md); the Oreslang Stack CLI has its own [README and certification limits](https://github.com/ores-truffle-oreslang/oreslang-stack-cli#not-yet-certified).

## Temporary CI mirrors are not project ownership

An exact copy of a private Oreslang source tree may be hosted temporarily in an **approved private** ORES Stack test branch (or another explicitly authorized private GitHub organization with available Actions runners) solely to execute tests. Do not make mirrored sources public or publish them in CI artifacts/logs. Such a branch does **not** make Oreslang Stack part of ORES Stack or change its authoritative source repository. CI must check out the local mirror, rather than using the test repository's token to access private source across organizations.

Before reporting those tests as evidence, verify the **exact source Git tree SHA** against the copied subtree and confirm the jobs actually ran. A workflow failing before runner allocation, or a green job from an older tree, does not certify the new source head.

The organization profile content is [`profile/README.md`](profile/README.md). **Visibility:** this `.github` repository is currently **private**; the profile cannot be relied upon as a public organization introduction. A public profile requires separately reviewing its contents and explicitly approving a visibility/publication change.
