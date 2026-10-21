# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.2.x | ✅ |
| < 1.2 | ❌ (never published) |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report it privately through GitHub's
[**Report a vulnerability**](https://github.com/alipkcode/Pro_Terminal/security/advisories/new) form
(*Security › Advisories*). Include:

- what the issue is and what an attacker could do with it,
- steps to reproduce, or a proof of concept,
- the Pro Terminal version (*Settings › About*) and your Windows version.

You'll get a reply within a few days. A fix is released as soon as possible, and you're credited in the
release notes unless you'd rather not be.

## Scope

Pro Terminal runs your own shells with your own permissions. Commands you type or save as snippets run
exactly as they would in any other terminal. Relevant reports include, for example, the renderer
escaping its sandbox, IPC that a web page could reach, or data files being written outside
`%APPDATA%\Pro Terminal`.
