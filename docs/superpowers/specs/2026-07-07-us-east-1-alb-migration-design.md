# Design: Migrate LLMquality & GEDquality to us-east-1 behind an ALB

**Date:** 2026-07-07
**Status:** Approved by user, ready for implementation planning

## Context

LLMquality (port 3000, this repo) and GEDquality (port 3001, `../GEDquality`) currently
run as PM2 processes on a single Ubuntu EC2 instance (`i-071a5b6dc60c2099a`, "Test Instance",
`t3.micro`, us-west-2, public IP `44.251.131.135`), reachable directly on their raw ports
with no load balancer, no TLS, and an over-broad IAM instance profile
(`research-dataset-reader-instance-profile`, which carries `s3:*`).

Goal: move both apps to us-east-1, put them behind subdomains and a load balancer so
neither app server is directly internet-reachable, scope down IAM permissions, and get
notified by email if either app goes down.

Both apps were confirmed to make **no AWS API calls at runtime** (no AWS SDK dependency
in either `package.json`) — this is what makes the aggressive IAM scope-down safe.

## Existing AWS resources this design reuses (verified via AWS CLI, 2026-07-07)

- **VPC:** `ResearchPublicPrivateVPC` (`vpc-0527c9c104e10932e`, CIDR `10.99.0.0/16`, us-east-1)
  - Public subnets: `ResearchPublicVPCPublic1a` (`subnet-0b624596b39498796`), `ResearchPublicVPCPublic1b` (`subnet-07ab8b979f7b341f0`) — route to IGW `igw-06b779576dc24925a`
  - Private subnets (6, spread 1a–1f) — route to NAT Gateway `nat-02f24c24fc71a77d5` (in `Public1a`)
- **Security groups (reused as-is):**
  - `ResearchPublicAlbSG` (`sg-05ec83901079089cf`) — inbound `443` from `0.0.0.0/0` only, no port 80. Used for the new ALB.
- **DNS:** `researchllm.org` public hosted zone (`Z02265312H40Y5FCL4DB`), already owned by this account.
- Pattern followed but not reused directly: `ResearchAlbWebService` SG (inbound `80` from `ResearchPublicAlbSG` only, no SSH) — this repo's new SGs clone this pattern on ports 3000/3001 instead of 80, since rebinding the apps to port 80 would require root/extra tooling.

## Architecture

```
Internet
   |
   v
[ALB: quality-apps-alb]  (public subnets, SG=ResearchPublicAlbSG, HTTPS:443 only)
   |-- Host: llmquality.researchllm.org --> [llmquality-tg :3000] --> [EC2: llmquality-app] (private subnet)
   |-- Host: gedquality.researchllm.org --> [gedquality-tg :3001] --> [EC2: gedquality-app] (private subnet)
```

Neither EC2 instance has a public IP or any inbound rule except "from the ALB, on my
app's port." Admin access is via SSM Session Manager only — no SSH, no key pair assigned.

## Components

### Security groups (new)

| Name | Inbound | Outbound | Attached to |
|---|---|---|---|
| `LLMqualityAppSG` | TCP 3000 from `ResearchPublicAlbSG` | all | llmquality-app instance |
| `GEDqualityAppSG` | TCP 3001 from `ResearchPublicAlbSG` | all | gedquality-app instance |

No SSH (port 22) on either. SSM needs no inbound rule — the private subnets already
route outbound through the existing NAT Gateway.

### IAM

One shared instance profile: **`EC2_Research_Quality_WebService`**, with only
`AmazonSSMManagedInstanceCore` attached. Attached to both instances. Deliberately shared
(not per-app) since both apps need identical (SSM-only) permissions today. If either app
ever needs an AWS API permission the other doesn't, split into per-app roles at that time.

### Compute

Two EC2 instances, Ubuntu 24.04 LTS, `t3.micro`, 20GB gp3 root volume, no key pair:

| Name | App | Port | Subnet | SG | IAM profile |
|---|---|---|---|---|---|
| `llmquality-app` | LLMquality | 3000 | a private subnet | `LLMqualityAppSG` | `EC2_Research_Quality_WebService` |
| `gedquality-app` | GEDquality | 3001 | a different private subnet (AZ diversity) | `GEDqualityAppSG` | `EC2_Research_Quality_WebService` |

### Load balancer

One internet-facing ALB (`quality-apps-alb`), in the two public subnets,
SG = `ResearchPublicAlbSG` (reused unmodified). Single listener: **HTTPS 443 only** — no
port 80 / redirect listener, matching this VPC's existing convention (`ResearchPublicAlbSG`
doesn't even open port 80).

Target groups (type: instance, protocol HTTP, health check path `/`, expect 200 — both
apps already have a working root route so no app code change needed for health checks):

- `llmquality-tg` → `llmquality-app:3000`
- `gedquality-tg` → `gedquality-app:3001`

Listener rules (host-header based):
- `Host == llmquality.researchllm.org` → `llmquality-tg`
- `Host == gedquality.researchllm.org` → `gedquality-tg`

### DNS + TLS

- New ACM certificate in us-east-1 (region must match the ALB), SAN covering
  `llmquality.researchllm.org` and `gedquality.researchllm.org`, DNS-validated against
  the existing `researchllm.org` zone (validation CNAMEs added automatically since we
  own the zone).
- Two Route 53 alias records, one per subdomain, pointing at the ALB's DNS name.

### Health alerting

- CloudWatch Alarms on `UnHealthyHostCount` (namespace `AWS/ApplicationELB`), one per
  target group: `llmquality-tg-unhealthy`, `gedquality-tg-unhealthy`. Threshold: >= 1.
- One shared SNS topic, `quality-app-health-alerts`, with an email subscription to
  `rsturley@churchofjesuschrist.org`. Both alarms notify this topic; the email body names
  which alarm fired so the two apps are distinguishable from one inbox subscription.
- Alarm action fires only on the OK → ALARM state transition (CloudWatch default
  behavior) — satisfies "one email when it first goes inactive, silence while it stays
  inactive, a new email if it recovers then fails again." No OK-state (recovery) email is
  configured, per explicit request.
- **Manual step:** the SNS email subscription requires a one-time confirmation click in
  the recipient's inbox — this cannot be automated (anti-abuse measure).

## App-level hardening (found during discovery, not infra, but in scope for "harden security")

- GEDquality already uses `helmet` + `express-rate-limit`. **LLMquality has neither** and
  is about to become internet-facing for the first time — add both before cutover, same
  libraries GEDquality already proves out.
- Both apps already cap uploads at 10MB via multer — no change needed.

## Migration / cutover plan

1. Provision new instances, SGs, IAM role, ALB, target groups, ACM cert, DNS records,
   CloudWatch alarms, SNS topic — all additive, zero risk to the running us-west-2
   instance.
2. Add `helmet` + `express-rate-limit` to LLMquality.
3. Deploy both apps to the new instances via SSM (`aws ssm start-session` /
   `send-command`), replacing the SSH-based deploy flow in the saved deployment memory —
   that memory needs updating after cutover.
4. Confirm the SNS email subscription (manual click).
5. Validate both subdomains end-to-end against the new ALB before touching DNS.
6. Cut over DNS to the new ALB records.
7. Monitor; stop (don't terminate) the old us-west-2 instance for a rollback window.
8. Terminate the old instance once confident; update the EC2 deployment memory file.

## Security evaluation summary

Improvements over current state:
- App servers no longer directly internet-reachable (private subnets, ALB-only ingress).
- TLS added (currently none — apps are served raw HTTP on high ports).
- IAM permissions cut from `s3:*` + `ec2:StopInstances` (current profile) down to
  SSM-core-only (new shared profile) — apps use none of the broader permissions.
- SSH access removed entirely in favor of SSM Session Manager (no long-lived SSH key to
  leak or rotate).
- LLMquality gains security middleware (helmet, rate limiting) it currently lacks.
- Failure of either app now pages the owner automatically instead of going unnoticed.

Residual risk / explicitly out of scope for this design:
- No WAF attached to the ALB. Deliberately deferred — nothing observed yet justifies its
  cost. Documented in both apps' `README.md` (added 2026-07-07): why it might become
  necessary, which CloudWatch/log signals to watch for, and how to add it later (purely
  additive to the existing ALB, no redesign).
- No automated scaling/multi-instance redundancy per app (single instance per target
  group) — acceptable given current traffic; the ALB pattern supports adding more
  instances to a target group later without redesign.
