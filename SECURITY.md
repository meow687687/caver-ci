# Security policy

Do not report vulnerabilities in a public issue. If GitHub private vulnerability reporting is enabled for this repository, use it. Otherwise, contact the maintainer through the `meow687687` GitHub profile and request a private reporting channel before sharing details.

Include the affected version or commit, reproduction steps, impact, and any known mitigations. Do not include credentials or private user data in the report.

This project is an analyzer, not a workflow sandbox. It parses workflow YAML as data and does not execute workflow commands. Repository mode makes read-only GitHub API requests and reads an optional token from `GITHUB_TOKEN`; reports should never contain the token.
