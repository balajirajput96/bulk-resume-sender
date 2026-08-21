# Perplexity App Discovery Inventory

**Scope:** Read-only inventory created from authenticated workspace navigation on 2026-08-21. It records only project names and high-level app signals; it does not copy message bodies, account secrets, personal medical content, or other sensitive chat details.

## Authenticated workspace signals

| Source | Verified signal | Initial interpretation | Correlation status |
|---|---|---|---|
| Workspace project | `balaji` | User-owned project space; detailed content not yet reviewed. | Pending read-only inspection |
| Workspace project | `ai agent` | Potential automation/agent work area. | Pending read-only inspection |
| Session title | Personalized resume outreach / n8n workflow setup | Matches the existing Bulk Resume & Email Sender implementation and related Gmail resume mailer work. | Candidate matched |
| Session title | QA Officer resume PDF generation | Matches the existing professional-resume project family. | Candidate matched |
| Session title | Social/Reels workflow discussions | May relate to Health Reels or daily research automation repositories. | Candidate to verify |

## `balaji` project classification

The opened `balaji` project contains a mixture of non-code research conversations and two app-relevant signals: a personalized resume-outreach/n8n workflow and a resume-PDF generator. The app-relevant requirements correspond to existing user-owned work already present in the Bulk Resume Sender and professional-resume repository families. Personal-health, general research, and unrelated account conversations were not extracted or added to the implementation queue.

## `ai agent` project access boundary

The workspace indicates that `ai agent` is owned by an enterprise organization and the currently authenticated account does not have permission to view it. No content, artifacts, code, ownership transfer, or access-control change was attempted. This project is excluded from implementation work unless the user later obtains legitimate access through the owning organization.

## Verified code correlations

| Perplexity signal | Original repository | Current verified state | Implementation decision |
|---|---|---|---|
| Personalized resume-outreach workflow | `bulk-resume-sender` | Private full-stack app with S3 attachments, AI drafting, Gmail OAuth route, scheduling, campaign history, six passing regression tests, and a passing CI workflow. | Primary mature implementation; improve here rather than create a duplicate. |
| Earlier Gmail resume mailer | `gmail-resume-mailer` | Private full-stack application with passing CI. | Treat as a separate legacy/parallel codebase until a source-level comparison proves consolidation is safe. |
| Automated pharma outreach | `pharma-outreach-automation` | Private automation repository with passing safeguards workflow. | Keep as distinct automation logic; do not merge into the web app without a verified feature overlap. |
| QA Officer resume generator | `professional-resume-balaji-rajput` | Public resume-generation project with a passing verification workflow. | Treat as a distinct document artifact rather than an application feature. |

All four verified candidate repositories currently have successful latest workflows. The current priority is to inspect the primary Bulk Resume Sender implementation for an evidence-backed improvement rather than make speculative or duplicate changes.

## Exclusions

The authenticated session list also contains personal research, health, account, and other non-code conversations. These are excluded from source-code discovery unless the user explicitly identifies them as an application requirement.

## Next verification steps

1. Inspect the two user-created Perplexity projects only for app-requirement summaries and artifact/code links.
2. Correlate each verified signal to existing local workspaces and original GitHub repositories.
3. Prioritize a single user-owned application for an evidence-backed improvement, test, and safe GitHub publication.
