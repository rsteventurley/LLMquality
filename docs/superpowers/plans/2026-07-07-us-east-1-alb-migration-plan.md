# US-East-1 ALB Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move LLMquality and GEDquality off the shared us-west-2 instance onto two dedicated, private-subnet EC2 instances in us-east-1, fronted by a single ALB with host-based routing, TLS, least-privilege IAM, and automated down-alerting.

**Architecture:** Two Ubuntu 24.04 EC2 instances (no public IP, no SSH, SSM-only admin) in `ResearchPublicPrivateVPC`'s private subnets, each running one app under systemd. A single internet-facing ALB in the VPC's public subnets terminates TLS and routes by hostname to per-app target groups. CloudWatch alarms on target-group health publish to an SNS topic with an email subscription.

**Tech Stack:** AWS EC2, IAM, VPC (existing), ELBv2 (ALB), ACM, Route 53, SNS, CloudWatch, SSM (Session Manager + Run Command), Ubuntu 24.04 + nvm/Node.js + systemd, Express (existing apps), helmet + express-rate-limit (new).

**Reference:** Full design rationale in `docs/superpowers/specs/2026-07-07-us-east-1-alb-migration-design.md`.

## Global Constraints

- Region for all new resources: **us-east-1**. Account: `013925090051`.
- VPC: `ResearchPublicPrivateVPC` (`vpc-0527c9c104e10932e`).
- Public subnets (ALB): `subnet-0b624596b39498796` (us-east-1a), `subnet-07ab8b979f7b341f0` (us-east-1b).
- Private subnets (apps): `subnet-04ac97b0c64ae8b55` (us-east-1a) for LLMquality; `subnet-052062acb481658d0` (us-east-1b) for GEDquality.
- ALB security group (reused, unmodified): `ResearchPublicAlbSG` (`sg-05ec83901079089cf`).
- IAM: one shared instance profile/role, **`EC2_Research_Quality_WebService`**, with only `AmazonSSMManagedInstanceCore` attached.
- New security groups: `LLMqualityAppSG` (TCP 3000 from `sg-05ec83901079089cf` only), `GEDqualityAppSG` (TCP 3001 from `sg-05ec83901079089cf` only). No SSH on either.
- Instances: Ubuntu 24.04 LTS (resolved dynamically via SSM public parameter), `t3.micro`, 20GB gp3 root volume, **no key pair**.
- Domain: `researchllm.org` hosted zone (`Z02265312H40Y5FCL4DB`). Subdomains: `llmquality.researchllm.org`, `gedquality.researchllm.org`.
- ALB: `quality-apps-alb`. Target groups: `llmquality-tg` (port 3000), `gedquality-tg` (port 3001). Health check path `/` on both.
- SNS topic: `quality-app-health-alerts`, email subscriber `rsturley@churchofjesuschrist.org`. CloudWatch alarms: `llmquality-tg-unhealthy`, `gedquality-tg-unhealthy` on `AWS/ApplicationELB` `UnHealthyHostCount` >= 1.
- Old instance `i-071a5b6dc60c2099a` (us-west-2): **stop, never terminate, as part of this plan.**
- GitHub repos: `rsteventurley/LLMquality` is **private** (needs a read-only deploy key). `rsteventurley/GEDquality` is **public** (plain HTTPS clone, no auth).
- Every AWS CLI command below assumes your default profile/session already has admin access (as already verified via `aws sts get-caller-identity`). Every task below creates or costs real, billable AWS resources — review each task's output before starting the next one.
- Local scratch directory for this plan's working files: `mkdir -p /tmp/quality-migration` (create once, first task).

---

### Task 1: Harden LLMquality with helmet + rate limiting

**Files:**
- Modify: `LLMquality.js:1-30` (add requires, middleware, apply limiter to the one API route)
- Modify: `package.json` (add `helmet`, `express-rate-limit` dependencies)
- Test: `test/securityHardeningTest.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks depend on — this is a standalone app-code hardening change, independent of the infra tasks that follow.

- [ ] **Step 1: Write the failing test**

Create `test/securityHardeningTest.js`:

```javascript
/**
 * Security hardening integration tests for the LLMquality server
 * Requires the server to be running on port 3000 (see README "Running Tests")
 */

const assert = require('assert');
const http = require('http');

describe('LLMquality Security Hardening', function() {
    const serverHost = 'localhost';
    const serverPort = 3000;

    describe('Helmet security headers', function() {
        it('should set X-Content-Type-Options on the root route', function(done) {
            http.get(`http://${serverHost}:${serverPort}/`, (res) => {
                assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
                done();
            }).on('error', done);
        });

        it('should set X-Frame-Options on the root route', function(done) {
            http.get(`http://${serverHost}:${serverPort}/`, (res) => {
                assert.ok(res.headers['x-frame-options'], 'expected X-Frame-Options header to be present');
                done();
            }).on('error', done);
        });
    });

    describe('Rate limiting on /api/rate', function() {
        it('should attach RateLimit headers to /api/rate responses', function(done) {
            const req = http.request({
                host: serverHost,
                port: serverPort,
                path: '/api/rate',
                method: 'POST'
            }, (res) => {
                assert.ok(
                    res.headers['ratelimit-limit'] !== undefined,
                    'expected a RateLimit-Limit header on /api/rate'
                );
                done();
            });
            req.on('error', done);
            req.end();
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

In one terminal: `npm start` (from `/home/rsturley/source/nodejs/LLMquality`).
In a second terminal:

Run: `npx mocha test/securityHardeningTest.js --timeout 10000`
Expected: FAIL — `x-content-type-options` / `x-frame-options` / `ratelimit-limit` headers are all `undefined` today, since neither `helmet` nor `express-rate-limit` is installed yet.

- [ ] **Step 3: Install dependencies and implement**

Run: `npm install helmet express-rate-limit`

Edit `LLMquality.js` — add requires after the existing `const os = require('os');` (line 12):

```javascript
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
```

Add the middleware right after `const app = express();` / `const PORT = ...` block, mirroring GEDquality's exact helmet config:

```javascript
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            upgradeInsecureRequests: null
        }
    }
}));
```

Add the limiter definition near the existing `const upload = multer({...})` block:

```javascript
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, error: 'Too many requests, please try again later.' }
});
```

Apply it to the one API route (currently `app.post('/api/rate', upload.fields([...`):

```javascript
app.post('/api/rate', uploadLimiter, upload.fields([
    { name: 'gedcom', maxCount: 1 },
    { name: 'xml', maxCount: 1 }
]), async (req, res) => {
```

- [ ] **Step 4: Run test to verify it passes**

Restart the server (`Ctrl+C` then `npm start` again in terminal 1), then in terminal 2:

Run: `npx mocha test/securityHardeningTest.js --timeout 10000`
Expected: PASS (3 passing)

Also run the full existing suite to confirm no regression: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add LLMquality.js package.json package-lock.json test/securityHardeningTest.js
git commit -m "feat: add helmet and rate limiting to LLMquality ahead of public exposure"
```

---

### Task 2: Create the shared IAM role and instance profile

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: nothing.
- Produces: IAM instance profile named `EC2_Research_Quality_WebService`, consumed by Task 4 and Task 5's `--iam-instance-profile` argument.

- [ ] **Step 1: Create the scratch directory and trust policy file**

```bash
mkdir -p /tmp/quality-migration
cat > /tmp/quality-migration/trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
```

- [ ] **Step 2: Create the role, attach the policy, create and populate the instance profile**

```bash
aws iam create-role \
  --role-name EC2_Research_Quality_WebService \
  --assume-role-policy-document file:///tmp/quality-migration/trust-policy.json \
  --description "Least-privilege role for LLMquality/GEDquality web app instances - SSM only, no AWS API usage by either app"

aws iam attach-role-policy \
  --role-name EC2_Research_Quality_WebService \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

aws iam create-instance-profile --instance-profile-name EC2_Research_Quality_WebService

aws iam add-role-to-instance-profile \
  --instance-profile-name EC2_Research_Quality_WebService \
  --role-name EC2_Research_Quality_WebService
```

- [ ] **Step 3: Verify**

```bash
sleep 10   # IAM changes are eventually consistent
aws iam get-instance-profile --instance-profile-name EC2_Research_Quality_WebService \
  --query 'InstanceProfile.Roles[0].RoleName' --output text
```
Expected: `EC2_Research_Quality_WebService`

```bash
aws iam list-attached-role-policies --role-name EC2_Research_Quality_WebService \
  --query 'AttachedPolicies[].PolicyName' --output text
```
Expected: `AmazonSSMManagedInstanceCore`

No commit — infrastructure-only task.

---

### Task 3: Create the two app security groups

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: `ResearchPublicAlbSG` (`sg-05ec83901079089cf`) as the allowed source.
- Produces: `LLMqualityAppSG` and `GEDqualityAppSG` group IDs, consumed by Task 4 and Task 5's `--security-group-ids`.

- [ ] **Step 1: Create LLMqualityAppSG and authorize inbound 3000 from the ALB**

```bash
LLM_SG_ID=$(aws ec2 create-security-group \
  --region us-east-1 \
  --group-name LLMqualityAppSG \
  --description "LLMquality app instance - inbound 3000 from ALB only, no SSH, SSM managed" \
  --vpc-id vpc-0527c9c104e10932e \
  --query 'GroupId' --output text)
echo "LLM_SG_ID=$LLM_SG_ID" | tee -a /tmp/quality-migration/env.sh

aws ec2 authorize-security-group-ingress \
  --region us-east-1 \
  --group-id "$LLM_SG_ID" \
  --protocol tcp --port 3000 \
  --source-group sg-05ec83901079089cf
```

- [ ] **Step 2: Create GEDqualityAppSG and authorize inbound 3001 from the ALB**

```bash
GED_SG_ID=$(aws ec2 create-security-group \
  --region us-east-1 \
  --group-name GEDqualityAppSG \
  --description "GEDquality app instance - inbound 3001 from ALB only, no SSH, SSM managed" \
  --vpc-id vpc-0527c9c104e10932e \
  --query 'GroupId' --output text)
echo "GED_SG_ID=$GED_SG_ID" | tee -a /tmp/quality-migration/env.sh

aws ec2 authorize-security-group-ingress \
  --region us-east-1 \
  --group-id "$GED_SG_ID" \
  --protocol tcp --port 3001 \
  --source-group sg-05ec83901079089cf
```

(Default egress on a newly created SG is already "allow all outbound" — no explicit egress rule needed.)

- [ ] **Step 3: Verify**

```bash
source /tmp/quality-migration/env.sh
aws ec2 describe-security-groups --region us-east-1 --group-ids "$LLM_SG_ID" "$GED_SG_ID" \
  --query 'SecurityGroups[].{Name:GroupName,Ingress:IpPermissions}' --output json
```
Expected: `LLMqualityAppSG` shows one ingress rule, TCP 3000, source `sg-05ec83901079089cf`; `GEDqualityAppSG` shows TCP 3001, same source.

No commit — infrastructure-only task.

---

### Task 4: Launch the llmquality-app instance

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: `EC2_Research_Quality_WebService` (Task 2), `$LLM_SG_ID` (Task 3), private subnet `subnet-04ac97b0c64ae8b55`.
- Produces: `$LLM_INSTANCE_ID`, consumed by Task 6, Task 8, Task 12.

- [ ] **Step 1: Resolve the current Ubuntu 24.04 AMI and its root device name**

```bash
AMI_ID=$(aws ssm get-parameters --region us-east-1 \
  --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query 'Parameters[0].Value' --output text)
echo "AMI_ID=$AMI_ID" | tee -a /tmp/quality-migration/env.sh

aws ec2 describe-images --region us-east-1 --image-ids "$AMI_ID" \
  --query 'Images[0].RootDeviceName' --output text
```
Expected: `/dev/sda1` (confirm this matches the `DeviceName` used in Step 2 below — if AWS ever changes it, update the block-device-mapping accordingly).

- [ ] **Step 2: Launch the instance**

```bash
source /tmp/quality-migration/env.sh
LLM_INSTANCE_ID=$(aws ec2 run-instances \
  --region us-east-1 \
  --image-id "$AMI_ID" \
  --instance-type t3.micro \
  --subnet-id subnet-04ac97b0c64ae8b55 \
  --security-group-ids "$LLM_SG_ID" \
  --iam-instance-profile Name=EC2_Research_Quality_WebService \
  --no-associate-public-ip-address \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=llmquality-app}]' \
  --query 'Instances[0].InstanceId' --output text)
echo "LLM_INSTANCE_ID=$LLM_INSTANCE_ID" | tee -a /tmp/quality-migration/env.sh
```

- [ ] **Step 3: Verify it's running, private-only, and SSM-managed**

```bash
source /tmp/quality-migration/env.sh
aws ec2 wait instance-running --region us-east-1 --instance-ids "$LLM_INSTANCE_ID"

aws ec2 describe-instances --region us-east-1 --instance-ids "$LLM_INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].{State:State.Name,PublicIp:PublicIpAddress,SGs:SecurityGroups[].GroupName,Profile:IamInstanceProfile.Arn}'
```
Expected: `State: running`, `PublicIp: null`, `SGs: ["LLMqualityAppSG"]`, `Profile` ends in `instance-profile/EC2_Research_Quality_WebService`.

```bash
# SSM registration can take 1-3 minutes after boot — poll until Online
for i in $(seq 1 20); do
  STATUS=$(aws ssm describe-instance-information --region us-east-1 \
    --filters "Key=InstanceIds,Values=$LLM_INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)
  echo "attempt $i: $STATUS"
  [ "$STATUS" = "Online" ] && break
  sleep 15
done
```
Expected: eventually prints `Online`.

No commit — infrastructure-only task.

---

### Task 5: Launch the gedquality-app instance

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: `EC2_Research_Quality_WebService` (Task 2), `$GED_SG_ID` (Task 3), `$AMI_ID` (Task 4), private subnet `subnet-052062acb481658d0`.
- Produces: `$GED_INSTANCE_ID`, consumed by Task 6, Task 8, Task 12.

- [ ] **Step 1: Launch the instance**

```bash
source /tmp/quality-migration/env.sh
GED_INSTANCE_ID=$(aws ec2 run-instances \
  --region us-east-1 \
  --image-id "$AMI_ID" \
  --instance-type t3.micro \
  --subnet-id subnet-052062acb481658d0 \
  --security-group-ids "$GED_SG_ID" \
  --iam-instance-profile Name=EC2_Research_Quality_WebService \
  --no-associate-public-ip-address \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=gedquality-app}]' \
  --query 'Instances[0].InstanceId' --output text)
echo "GED_INSTANCE_ID=$GED_INSTANCE_ID" | tee -a /tmp/quality-migration/env.sh
```

- [ ] **Step 2: Verify it's running, private-only, and SSM-managed**

```bash
source /tmp/quality-migration/env.sh
aws ec2 wait instance-running --region us-east-1 --instance-ids "$GED_INSTANCE_ID"

aws ec2 describe-instances --region us-east-1 --instance-ids "$GED_INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].{State:State.Name,PublicIp:PublicIpAddress,SGs:SecurityGroups[].GroupName,Profile:IamInstanceProfile.Arn}'
```
Expected: `State: running`, `PublicIp: null`, `SGs: ["GEDqualityAppSG"]`, `Profile` ends in `instance-profile/EC2_Research_Quality_WebService`.

```bash
for i in $(seq 1 20); do
  STATUS=$(aws ssm describe-instance-information --region us-east-1 \
    --filters "Key=InstanceIds,Values=$GED_INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)
  echo "attempt $i: $STATUS"
  [ "$STATUS" = "Online" ] && break
  sleep 15
done
```
Expected: eventually prints `Online`.

No commit — infrastructure-only task.

---

### Task 6: Bootstrap and deploy GEDquality (public repo) to gedquality-app

**Files:** none in this repo (remote instance setup only).

**Interfaces:**
- Consumes: `$GED_INSTANCE_ID` (Task 5).
- Produces: GEDquality running under systemd on port 3001 on the instance, consumed by Task 8's health check / target registration.

Helpers for running SSM commands (used throughout this task) — `run_ssm` prints the full result for verification, `run_ssm_output` returns just stdout so it can be captured into a variable. **Note:** the `--parameters` payload is built as a real JSON file via `python3 -c 'import json...'` rather than AWS CLI's inline shorthand syntax — the shorthand parser chokes on scripts containing embedded double quotes (needed by several steps below), so JSON-file input is the robust approach:

```bash
run_ssm() {
  local instance_id="$1" script="$2"
  local params_file cmd_id
  params_file=$(mktemp)
  python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]]}))' "$script" > "$params_file"
  cmd_id=$(aws ssm send-command --region us-east-1 \
    --instance-ids "$instance_id" \
    --document-name "AWS-RunShellScript" \
    --parameters "file://$params_file" \
    --query 'Command.CommandId' --output text)
  rm -f "$params_file"
  for i in $(seq 1 30); do
    STATUS=$(aws ssm get-command-invocation --region us-east-1 \
      --command-id "$cmd_id" --instance-id "$instance_id" \
      --query 'Status' --output text 2>/dev/null)
    [ "$STATUS" != "InProgress" ] && [ "$STATUS" != "Pending" ] && break
    sleep 5
  done
  aws ssm get-command-invocation --region us-east-1 \
    --command-id "$cmd_id" --instance-id "$instance_id" \
    --query '{Status:Status,StdOut:StandardOutputContent,StdErr:StandardErrorContent}' --output json
}

run_ssm_output() {
  local instance_id="$1" script="$2"
  local params_file cmd_id
  params_file=$(mktemp)
  python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]]}))' "$script" > "$params_file"
  cmd_id=$(aws ssm send-command --region us-east-1 \
    --instance-ids "$instance_id" \
    --document-name "AWS-RunShellScript" \
    --parameters "file://$params_file" \
    --query 'Command.CommandId' --output text)
  rm -f "$params_file"
  for i in $(seq 1 30); do
    STATUS=$(aws ssm get-command-invocation --region us-east-1 \
      --command-id "$cmd_id" --instance-id "$instance_id" \
      --query 'Status' --output text 2>/dev/null)
    [ "$STATUS" != "InProgress" ] && [ "$STATUS" != "Pending" ] && break
    sleep 5
  done
  aws ssm get-command-invocation --region us-east-1 \
    --command-id "$cmd_id" --instance-id "$instance_id" \
    --query 'StandardOutputContent' --output text
}
```

- [ ] **Step 1: Install git, nvm, Node.js LTS, as the ubuntu user**

```bash
source /tmp/quality-migration/env.sh
run_ssm "$GED_INSTANCE_ID" "apt-get update -y && apt-get install -y git && su - ubuntu -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash' && su - ubuntu -c 'source ~/.nvm/nvm.sh && nvm install --lts'"
```

- [ ] **Step 2: Verify Node.js is installed and capture its absolute path**

```bash
NODE_INFO=$(run_ssm_output "$GED_INSTANCE_ID" "su - ubuntu -c 'source ~/.nvm/nvm.sh && node --version && which node'")
echo "$NODE_INFO"
GED_NODE_PATH=$(echo "$NODE_INFO" | tail -n1 | tr -d '\r')
echo "GED_NODE_PATH=$GED_NODE_PATH" | tee -a /tmp/quality-migration/env.sh
```
Expected: first line is a Node version (e.g. `v22.x.x`), second line (now in `$GED_NODE_PATH`) is a path like `/home/ubuntu/.nvm/versions/node/v22.x.x/bin/node`.

- [ ] **Step 3: Clone the (public) repo and install dependencies**

```bash
run_ssm "$GED_INSTANCE_ID" "su - ubuntu -c 'git clone https://github.com/rsteventurley/GEDquality.git ~/source/GEDquality && source ~/.nvm/nvm.sh && cd ~/source/GEDquality && npm install --production'"
```

- [ ] **Step 4: Verify the clone and install succeeded**

```bash
run_ssm "$GED_INSTANCE_ID" "test -f /home/ubuntu/source/GEDquality/GEDquality.js && test -d /home/ubuntu/source/GEDquality/node_modules && echo OK"
```
Expected: `Status: Success`, stdout `OK`.

- [ ] **Step 5: Create and enable a systemd unit**

`$GED_NODE_PATH` (captured in Step 2) is expanded locally before this command is sent to SSM, so the remote unit file ends up with the literal resolved path baked in:

```bash
source /tmp/quality-migration/env.sh
run_ssm "$GED_INSTANCE_ID" "cat > /etc/systemd/system/gedquality.service <<'UNIT'
[Unit]
Description=GEDquality GEDCOM Integrity Checker
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/source/GEDquality
ExecStart=$GED_NODE_PATH GEDquality.js
Restart=on-failure
Environment=PORT=3001
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now gedquality"
```

- [ ] **Step 6: Verify the service is active and serving on 3001**

```bash
run_ssm "$GED_INSTANCE_ID" "systemctl is-active gedquality && curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/"
```
Expected: `Status: Success`, stdout contains `active` and `200`.

No commit — remote deployment only, no repo changes.

---

### Task 7: Set up a deploy key and deploy LLMquality (private repo) to llmquality-app

**Files:** none in this repo (remote instance setup + a GitHub deploy key).

**Interfaces:**
- Consumes: `$LLM_INSTANCE_ID` (Task 4), `gh` CLI already authenticated with `repo` + `admin:public_key` scopes (verified earlier).
- Produces: LLMquality running under systemd on port 3000 on the instance, consumed by Task 8.

Helpers for running SSM commands (repeated from Task 6 so this task is self-contained) — `run_ssm` prints the full result for verification, `run_ssm_output` returns just stdout so it can be captured into a variable. **Note:** the `--parameters` payload is built as a real JSON file via `python3 -c 'import json...'` rather than AWS CLI's inline shorthand syntax — the shorthand parser chokes on scripts containing embedded double quotes (needed by several steps below), so JSON-file input is the robust approach:

```bash
run_ssm() {
  local instance_id="$1" script="$2"
  local params_file cmd_id
  params_file=$(mktemp)
  python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]]}))' "$script" > "$params_file"
  cmd_id=$(aws ssm send-command --region us-east-1 \
    --instance-ids "$instance_id" \
    --document-name "AWS-RunShellScript" \
    --parameters "file://$params_file" \
    --query 'Command.CommandId' --output text)
  rm -f "$params_file"
  for i in $(seq 1 30); do
    STATUS=$(aws ssm get-command-invocation --region us-east-1 \
      --command-id "$cmd_id" --instance-id "$instance_id" \
      --query 'Status' --output text 2>/dev/null)
    [ "$STATUS" != "InProgress" ] && [ "$STATUS" != "Pending" ] && break
    sleep 5
  done
  aws ssm get-command-invocation --region us-east-1 \
    --command-id "$cmd_id" --instance-id "$instance_id" \
    --query '{Status:Status,StdOut:StandardOutputContent,StdErr:StandardErrorContent}' --output json
}

run_ssm_output() {
  local instance_id="$1" script="$2"
  local params_file cmd_id
  params_file=$(mktemp)
  python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]]}))' "$script" > "$params_file"
  cmd_id=$(aws ssm send-command --region us-east-1 \
    --instance-ids "$instance_id" \
    --document-name "AWS-RunShellScript" \
    --parameters "file://$params_file" \
    --query 'Command.CommandId' --output text)
  rm -f "$params_file"
  for i in $(seq 1 30); do
    STATUS=$(aws ssm get-command-invocation --region us-east-1 \
      --command-id "$cmd_id" --instance-id "$instance_id" \
      --query 'Status' --output text 2>/dev/null)
    [ "$STATUS" != "InProgress" ] && [ "$STATUS" != "Pending" ] && break
    sleep 5
  done
  aws ssm get-command-invocation --region us-east-1 \
    --command-id "$cmd_id" --instance-id "$instance_id" \
    --query 'StandardOutputContent' --output text
}
```

- [ ] **Step 1: Install git, nvm, Node.js LTS, as the ubuntu user**

```bash
source /tmp/quality-migration/env.sh
run_ssm "$LLM_INSTANCE_ID" "apt-get update -y && apt-get install -y git && su - ubuntu -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash' && su - ubuntu -c 'source ~/.nvm/nvm.sh && nvm install --lts'"
```

- [ ] **Step 2: Verify Node.js is installed and capture its absolute path**

```bash
NODE_INFO=$(run_ssm_output "$LLM_INSTANCE_ID" "su - ubuntu -c 'source ~/.nvm/nvm.sh && node --version && which node'")
echo "$NODE_INFO"
LLM_NODE_PATH=$(echo "$NODE_INFO" | tail -n1 | tr -d '\r')
echo "LLM_NODE_PATH=$LLM_NODE_PATH" | tee -a /tmp/quality-migration/env.sh
```
Expected: first line is a Node version, second line (now in `$LLM_NODE_PATH`) is a path like `/home/ubuntu/.nvm/versions/node/v22.x.x/bin/node`.

- [ ] **Step 3: Generate a deploy keypair on the instance and capture the public key**

```bash
LLM_DEPLOY_PUBKEY=$(run_ssm_output "$LLM_INSTANCE_ID" "su - ubuntu -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N \"\" -C llmquality-app-deploy-key -q && ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null && cat ~/.ssh/id_ed25519.pub'")
echo "$LLM_DEPLOY_PUBKEY"
```
Expected: a single line starting with `ssh-ed25519 AAAA...`.

- [ ] **Step 4: Register the public key as a read-only deploy key on GitHub**

```bash
echo "$LLM_DEPLOY_PUBKEY" > /tmp/quality-migration/llmquality-app-deploy-key.pub

gh repo deploy-key add /tmp/quality-migration/llmquality-app-deploy-key.pub \
  -R rsteventurley/LLMquality --title "llmquality-app-instance"
```
(No `-w`/`--allow-write` flag — this must be read-only, since the instance only ever pulls.)

- [ ] **Step 5: Verify the deploy key is registered as read-only**

```bash
gh repo deploy-key list -R rsteventurley/LLMquality
```
Expected: a row titled `llmquality-app-instance` with `Read/Write` column showing `Read-only` (or equivalent read-only indicator).

- [ ] **Step 6: Clone via SSH using the deploy key, install dependencies**

```bash
run_ssm "$LLM_INSTANCE_ID" "su - ubuntu -c 'GIT_SSH_COMMAND=\"ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=yes\" git clone git@github.com:rsteventurley/LLMquality.git ~/source/LLMquality && source ~/.nvm/nvm.sh && cd ~/source/LLMquality && npm install --production'"
```

- [ ] **Step 7: Verify the clone and install succeeded, then create and enable the systemd unit**

```bash
run_ssm "$LLM_INSTANCE_ID" "test -f /home/ubuntu/source/LLMquality/LLMquality.js && test -d /home/ubuntu/source/LLMquality/node_modules && echo OK"
```
Expected: `Status: Success`, stdout `OK`.

`$LLM_NODE_PATH` (captured in Step 2) is expanded locally before this command is sent to SSM, so the remote unit file ends up with the literal resolved path baked in:

```bash
source /tmp/quality-migration/env.sh
run_ssm "$LLM_INSTANCE_ID" "cat > /etc/systemd/system/llmquality.service <<'UNIT'
[Unit]
Description=LLMquality GEDCOM/XML Comparison Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/source/LLMquality
ExecStart=$LLM_NODE_PATH LLMquality.js
Restart=on-failure
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now llmquality"
```

- [ ] **Step 8: Verify the service is active and serving on 3000**

```bash
run_ssm "$LLM_INSTANCE_ID" "systemctl is-active llmquality && curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/"
```
Expected: `Status: Success`, stdout contains `active` and `200`.

No commit — remote deployment only, no repo changes.

---

### Task 8: Create the ALB, target groups, and register instances

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: `$LLM_INSTANCE_ID` (Task 4), `$GED_INSTANCE_ID` (Task 5).
- Produces: `$ALB_ARN`, `$LLM_TG_ARN`, `$GED_TG_ARN`, `$ALB_DNS_NAME`, `$ALB_ZONE_ID` — consumed by Task 9 (SAN names only, no dependency), Task 10, Task 11, Task 12.

- [ ] **Step 1: Create the ALB**

```bash
ALB_ARN=$(aws elbv2 create-load-balancer \
  --region us-east-1 \
  --name quality-apps-alb \
  --subnets subnet-0b624596b39498796 subnet-07ab8b979f7b341f0 \
  --security-groups sg-05ec83901079089cf \
  --scheme internet-facing --type application --ip-address-type ipv4 \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
echo "ALB_ARN=$ALB_ARN" | tee -a /tmp/quality-migration/env.sh
```

- [ ] **Step 2: Verify it's provisioning, then capture its DNS name and hosted zone ID**

```bash
aws elbv2 wait load-balancer-available --region us-east-1 --load-balancer-arns "$ALB_ARN"

ALB_DNS_NAME=$(aws elbv2 describe-load-balancers --region us-east-1 --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)
ALB_ZONE_ID=$(aws elbv2 describe-load-balancers --region us-east-1 --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)
echo "ALB_DNS_NAME=$ALB_DNS_NAME" | tee -a /tmp/quality-migration/env.sh
echo "ALB_ZONE_ID=$ALB_ZONE_ID" | tee -a /tmp/quality-migration/env.sh
```
Expected: both variables populated (DNS name like `quality-apps-alb-XXXXXXX.us-east-1.elb.amazonaws.com`).

- [ ] **Step 3: Create both target groups**

```bash
LLM_TG_ARN=$(aws elbv2 create-target-group \
  --region us-east-1 --name llmquality-tg --protocol HTTP --port 3000 \
  --vpc-id vpc-0527c9c104e10932e --target-type instance \
  --health-check-protocol HTTP --health-check-path / \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
echo "LLM_TG_ARN=$LLM_TG_ARN" | tee -a /tmp/quality-migration/env.sh

GED_TG_ARN=$(aws elbv2 create-target-group \
  --region us-east-1 --name gedquality-tg --protocol HTTP --port 3001 \
  --vpc-id vpc-0527c9c104e10932e --target-type instance \
  --health-check-protocol HTTP --health-check-path / \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
echo "GED_TG_ARN=$GED_TG_ARN" | tee -a /tmp/quality-migration/env.sh
```

- [ ] **Step 4: Register each instance in its target group**

```bash
source /tmp/quality-migration/env.sh
aws elbv2 register-targets --region us-east-1 --target-group-arn "$LLM_TG_ARN" --targets Id="$LLM_INSTANCE_ID"
aws elbv2 register-targets --region us-east-1 --target-group-arn "$GED_TG_ARN" --targets Id="$GED_INSTANCE_ID"
```

- [ ] **Step 5: Verify registration (not health yet — that needs a listener)**

```bash
source /tmp/quality-migration/env.sh
aws elbv2 describe-target-health --region us-east-1 --target-group-arn "$LLM_TG_ARN" \
  --query 'TargetHealthDescriptions[0].TargetHealth'
aws elbv2 describe-target-health --region us-east-1 --target-group-arn "$GED_TG_ARN" \
  --query 'TargetHealthDescriptions[0].TargetHealth'
```
Expected: both show `"State": "unused", "Reason": "Target.NotInUse"`. This is normal — a target group runs no health checks at all until a listener rule forwards to it, which doesn't happen until Task 10. Do not wait for `healthy` here; re-verify actual health after Task 10's listener/rules are created (Task 11 does this as part of end-to-end validation). If either target instead shows `unhealthy` or `initial` for more than a couple of minutes once Task 10 is done, re-check Task 6/7 Step 6/8's curl output on the instance itself.

No commit — infrastructure-only task.

---

### Task 9: Request and validate the ACM certificate

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: nothing from prior tasks (domain names are static constants).
- Produces: `$CERT_ARN`, consumed by Task 10.

- [ ] **Step 1: Request the certificate**

```bash
CERT_ARN=$(aws acm request-certificate \
  --region us-east-1 \
  --domain-name llmquality.researchllm.org \
  --subject-alternative-names gedquality.researchllm.org \
  --validation-method DNS \
  --query 'CertificateArn' --output text)
echo "CERT_ARN=$CERT_ARN" | tee -a /tmp/quality-migration/env.sh
sleep 10
```

- [ ] **Step 2: Fetch the DNS validation records ACM wants created, per domain**

No `jq` dependency — AWS CLI's own `--query` (JMESPath) can filter by domain name directly:

```bash
source /tmp/quality-migration/env.sh
LLM_VALIDATION_NAME=$(aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query "Certificate.DomainValidationOptions[?DomainName=='llmquality.researchllm.org'].ResourceRecord.Name" --output text)
LLM_VALIDATION_VALUE=$(aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query "Certificate.DomainValidationOptions[?DomainName=='llmquality.researchllm.org'].ResourceRecord.Value" --output text)
GED_VALIDATION_NAME=$(aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query "Certificate.DomainValidationOptions[?DomainName=='gedquality.researchllm.org'].ResourceRecord.Name" --output text)
GED_VALIDATION_VALUE=$(aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query "Certificate.DomainValidationOptions[?DomainName=='gedquality.researchllm.org'].ResourceRecord.Value" --output text)
echo "LLM_VALIDATION_NAME=$LLM_VALIDATION_NAME"
echo "LLM_VALIDATION_VALUE=$LLM_VALIDATION_VALUE"
echo "GED_VALIDATION_NAME=$GED_VALIDATION_NAME"
echo "GED_VALIDATION_VALUE=$GED_VALIDATION_VALUE"
```
Expected: all four variables populated — the two `*_NAME` values end in `.researchllm.org.` (trailing dot), the two `*_VALUE` values end in `.acm-validations.aws.`.

- [ ] **Step 3: Create both CNAME validation records in Route 53**

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z02265312H40Y5FCL4DB \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "'"$LLM_VALIDATION_NAME"'",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{ "Value": "'"$LLM_VALIDATION_VALUE"'" }]
      }
    }]
  }'

aws route53 change-resource-record-sets \
  --hosted-zone-id Z02265312H40Y5FCL4DB \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "'"$GED_VALIDATION_NAME"'",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{ "Value": "'"$GED_VALIDATION_VALUE"'" }]
      }
    }]
  }'
```

- [ ] **Step 4: Verify the certificate becomes ISSUED**

```bash
aws acm wait certificate-validated --region us-east-1 --certificate-arn "$CERT_ARN"
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query 'Certificate.Status' --output text
```
Expected: `ISSUED`. This can take a few minutes for DNS propagation — the `wait` command blocks until it's ready (or times out after ~10 minutes; re-run if it times out).

No commit — infrastructure-only task.

---

### Task 10: Create the HTTPS listener and host-based routing rules

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: `$ALB_ARN` (Task 8), `$CERT_ARN` (Task 9), `$LLM_TG_ARN` / `$GED_TG_ARN` (Task 8).
- Produces: `$LISTENER_ARN`, consumed only for this task's own verification.

- [ ] **Step 1: Create the HTTPS:443 listener with a default 404 fixed-response**

```bash
source /tmp/quality-migration/env.sh
LISTENER_ARN=$(aws elbv2 create-listener \
  --region us-east-1 \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTPS --port 443 \
  --certificates CertificateArn="$CERT_ARN" \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --default-actions '[{"Type":"fixed-response","FixedResponseConfig":{"MessageBody":"Not Found","StatusCode":"404","ContentType":"text/plain"}}]' \
  --query 'Listeners[0].ListenerArn' --output text)
echo "LISTENER_ARN=$LISTENER_ARN" | tee -a /tmp/quality-migration/env.sh
```

- [ ] **Step 2: Add the two host-based rules**

```bash
aws elbv2 create-rule \
  --region us-east-1 \
  --listener-arn "$LISTENER_ARN" \
  --priority 10 \
  --conditions '[{"Field":"host-header","HostHeaderConfig":{"Values":["llmquality.researchllm.org"]}}]' \
  --actions '[{"Type":"forward","TargetGroupArn":"'"$LLM_TG_ARN"'"}]'

aws elbv2 create-rule \
  --region us-east-1 \
  --listener-arn "$LISTENER_ARN" \
  --priority 20 \
  --conditions '[{"Field":"host-header","HostHeaderConfig":{"Values":["gedquality.researchllm.org"]}}]' \
  --actions '[{"Type":"forward","TargetGroupArn":"'"$GED_TG_ARN"'"}]'
```

- [ ] **Step 3: Verify**

```bash
aws elbv2 describe-rules --region us-east-1 --listener-arn "$LISTENER_ARN" \
  --query 'Rules[].{Priority:Priority,Host:Conditions[0].HostHeaderConfig.Values,Action:Actions[0].TargetGroupArn}'
```
Expected: two rules (priority 10 → llmquality host → `$LLM_TG_ARN`; priority 20 → gedquality host → `$GED_TG_ARN`), plus the default rule.

No commit — infrastructure-only task.

---

### Task 11: Create Route 53 records and validate end-to-end

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: `$ALB_DNS_NAME`, `$ALB_ZONE_ID` (Task 8), completed listener/rules (Task 10).
- Produces: working public HTTPS endpoints for both apps.

- [ ] **Step 1: Create the alias record for llmquality.researchllm.org**

```bash
source /tmp/quality-migration/env.sh
aws route53 change-resource-record-sets \
  --hosted-zone-id Z02265312H40Y5FCL4DB \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "llmquality.researchllm.org",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "'"$ALB_ZONE_ID"'",
          "DNSName": "'"$ALB_DNS_NAME"'",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

- [ ] **Step 2: Create the alias record for gedquality.researchllm.org**

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z02265312H40Y5FCL4DB \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "gedquality.researchllm.org",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "'"$ALB_ZONE_ID"'",
          "DNSName": "'"$ALB_DNS_NAME"'",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

- [ ] **Step 3: Verify DNS resolution and HTTPS end-to-end**

```bash
sleep 30
dig +short llmquality.researchllm.org
dig +short gedquality.researchllm.org
curl -s -o /dev/null -w 'llmquality: %{http_code}\n' https://llmquality.researchllm.org/
curl -s -o /dev/null -w 'gedquality: %{http_code}\n' https://gedquality.researchllm.org/
```
Expected: both `dig` commands return an IP; both `curl` commands print `200`.

No commit — infrastructure-only task.

---

### Task 12: Create SNS topic and CloudWatch health alarms

**Files:** none (AWS resources only).

**Interfaces:**
- Consumes: `$LLM_TG_ARN`, `$GED_TG_ARN`, `$ALB_ARN` (Task 8).
- Produces: email alerting on either target group going unhealthy.

- [ ] **Step 1: Create the SNS topic and subscribe the email address**

```bash
source /tmp/quality-migration/env.sh
TOPIC_ARN=$(aws sns create-topic --region us-east-1 --name quality-app-health-alerts \
  --query 'TopicArn' --output text)
echo "TOPIC_ARN=$TOPIC_ARN" | tee -a /tmp/quality-migration/env.sh

aws sns subscribe --region us-east-1 --topic-arn "$TOPIC_ARN" \
  --protocol email --notification-endpoint rsturley@churchofjesuschrist.org
```

- [ ] **Step 2: Confirm the subscription (manual step)**

Check `rsturley@churchofjesuschrist.org` for an email from AWS Notifications titled "AWS Notification - Subscription Confirmation" and click "Confirm subscription."

Verify:
```bash
aws sns list-subscriptions-by-topic --region us-east-1 --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[0].SubscriptionArn' --output text
```
Expected (after clicking the link): a real ARN, not the literal string `PendingConfirmation`.

- [ ] **Step 3: Extract the CloudWatch dimension values from the ARNs**

```bash
LLM_TG_DIM=$(echo "$LLM_TG_ARN" | sed -E 's#.*:(targetgroup/.*)#\1#')
GED_TG_DIM=$(echo "$GED_TG_ARN" | sed -E 's#.*:(targetgroup/.*)#\1#')
ALB_DIM=$(echo "$ALB_ARN" | sed -E 's#.*:loadbalancer/(app/.*)#\1#')
echo "LLM_TG_DIM=$LLM_TG_DIM"
echo "GED_TG_DIM=$GED_TG_DIM"
echo "ALB_DIM=$ALB_DIM"
```
Expected: `LLM_TG_DIM` like `targetgroup/llmquality-tg/xxxxxxxxxxxxxxxx`, `GED_TG_DIM` similarly, `ALB_DIM` like `app/quality-apps-alb/xxxxxxxxxxxxxxxx`.

- [ ] **Step 4: Create both CloudWatch alarms**

```bash
aws cloudwatch put-metric-alarm \
  --region us-east-1 \
  --alarm-name llmquality-tg-unhealthy \
  --namespace AWS/ApplicationELB \
  --metric-name UnHealthyHostCount \
  --dimensions Name=TargetGroup,Value="$LLM_TG_DIM" Name=LoadBalancer,Value="$ALB_DIM" \
  --statistic Maximum --period 60 --evaluation-periods 1 \
  --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN"

aws cloudwatch put-metric-alarm \
  --region us-east-1 \
  --alarm-name gedquality-tg-unhealthy \
  --namespace AWS/ApplicationELB \
  --metric-name UnHealthyHostCount \
  --dimensions Name=TargetGroup,Value="$GED_TG_DIM" Name=LoadBalancer,Value="$ALB_DIM" \
  --statistic Maximum --period 60 --evaluation-periods 1 \
  --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN"
```

- [ ] **Step 5: Verify**

```bash
aws cloudwatch describe-alarms --region us-east-1 \
  --alarm-names llmquality-tg-unhealthy gedquality-tg-unhealthy \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Actions:AlarmActions}'
```
Expected: both alarms present, `State: OK` (both targets are currently healthy), `Actions` containing `$TOPIC_ARN`.

**Optional manual test** (not automated here, since it causes a real brief outage and a real email): stop the `llmquality` systemd service on the instance (`run_ssm "$LLM_INSTANCE_ID" "systemctl stop llmquality"`), wait ~2-3 minutes for the ALB health check + alarm evaluation period to catch it, confirm the email arrives, then restart it (`systemctl start llmquality`).

No commit — infrastructure-only task.

---

### Task 13: Stop the old us-west-2 instance

**Files:** none (AWS resource only).

**Interfaces:**
- Consumes: nothing from prior tasks — independent cleanup step, but do this last, after Task 11's end-to-end verification passes.

- [ ] **Step 1: Stop (do not terminate) the old instance**

```bash
aws ec2 stop-instances --region us-west-2 --instance-ids i-071a5b6dc60c2099a
```

- [ ] **Step 2: Verify**

```bash
aws ec2 wait instance-stopped --region us-west-2 --instance-ids i-071a5b6dc60c2099a
aws ec2 describe-instances --region us-west-2 --instance-ids i-071a5b6dc60c2099a \
  --query 'Reservations[0].Instances[0].State.Name' --output text
```
Expected: `stopped`.

No commit — infrastructure-only task.

**Not part of this plan, deliberately:** terminating `i-071a5b6dc60c2099a` outright. Per the design doc, that should only happen after a rollback-window monitoring period once you're confident in the new setup — a manual decision at a later date, not an automated step here.
