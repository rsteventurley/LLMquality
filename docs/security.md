# Security Architecture

This documents the security posture of LLMquality and GEDquality as of the
2026-07-07 migration to us-east-1. Full design rationale and the exact commands used
are in `docs/superpowers/specs/2026-07-07-us-east-1-alb-migration-design.md` and
`docs/superpowers/plans/2026-07-07-us-east-1-alb-migration-plan.md`.

## Before

Both apps ran as PM2 processes on a single shared EC2 instance in us-west-2, directly
reachable on their raw ports (3000, 3001) over plain HTTP at a public IP, with SSH
enabled and an IAM instance profile carrying broad `s3:*` access neither app used.

## After: how the two apps are organized now

```
Internet
   |
   v
[ALB: quality-apps-alb]  (public subnets, HTTPS:443 only, TLS via ACM cert)
   |-- Host: llmquality.researchllm.org --> [llmquality-tg :3000] --> [llmquality-app EC2] (private subnet)
   |-- Host: gedquality.researchllm.org --> [gedquality-tg :3001] --> [gedquality-app EC2] (private subnet)
```

- **One dedicated EC2 instance per app** (`llmquality-app`, `gedquality-app`), each in a
  private subnet of `ResearchPublicPrivateVPC` — no public IP, no route to the internet
  except outbound via the VPC's NAT Gateway.
- **A single ALB is the only internet-facing component.** It terminates TLS and routes
  by hostname to the correct app's target group. Neither app instance is reachable
  directly — only from the ALB, and only on that app's specific port.
- Each app runs under its own **systemd** service (`llmquality.service`,
  `gedquality.service`), restarting automatically on crash or reboot.

## How this hardens security

**Network isolation.** Each instance's security group allows inbound traffic *only*
from the ALB's security group, on that one app's port (3000 or 3001) — nothing else,
from nowhere else. Previously both apps were reachable directly from the internet on
their raw ports.

**No SSH, anywhere.** Neither instance has an SSH port open or even a key pair assigned.
All administrative access goes through AWS Systems Manager Session Manager, which needs
no inbound security group rule at all — there's no long-lived SSH key to leak, rotate,
or brute-force.

**TLS everywhere in transit from the browser.** Both subdomains are served over HTTPS
with a certificate issued and DNS-validated through ACM. The previous setup served
plain HTTP on raw ports.

**Least-privilege IAM.** Both instances share one IAM role,
`EC2_Research_Quality_WebService`, which grants only `AmazonSSMManagedInstanceCore` —
enough to be managed via SSM, nothing else. The previous instance profile granted
account-wide `s3:*` and `ec2:StopInstances`, neither of which either app's code ever
uses (confirmed: neither app has an AWS SDK dependency). If either app were ever
compromised via a malicious upload, the blast radius is now "can call SSM APIs," not
"can read/write any S3 bucket in the account."

**App-level hardening.** LLMquality gained `helmet` (security response headers:
`X-Content-Type-Options`, `X-Frame-Options`, a restrictive default CSP) and
`express-rate-limit` on its upload endpoint, matching the protections GEDquality
already had. Both apps already capped uploads at 10MB.

**Automated failure detection.** CloudWatch alarms watch each target group's
`UnHealthyHostCount` and notify an SNS topic (email) the moment either app goes down —
one notification per failure, not a flood, and a fresh one if it recovers and fails
again. Previously an outage would go unnoticed until someone happened to check.

**Isolation between the two apps.** Each app has its own instance, its own security
group, and its own target group. A crash, resource exhaustion, or compromise in one app
has no direct path to affecting the other — they only share the outer ALB and the IAM
role (which grants no meaningful privilege to begin with).

## What's deliberately not in place yet

**AWS WAF** is not attached to the ALB. See the "Web Application Firewall (WAF)"
section in this repo's `README.md` (and GEDquality's) for why, what would indicate it's
needed, and how to add it later — it's purely additive to the existing ALB, no
redesign required.

**No auto-scaling / multi-instance redundancy.** Each target group has exactly one
instance. Acceptable at current traffic levels; the ALB/target-group pattern already
supports adding more instances per app later without any architectural change.
