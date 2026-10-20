#!/usr/bin/env bash
#
# Allocate (or reuse) a stable Elastic IP and associate it with the VelisMail
# EC2 instance. Run this from a machine with AWS credentials, or from AWS
# CloudShell in the same account:
#
#   AWS_REGION=us-east-1 bash deploy/native/setup-elastic-ip.sh i-0d1aaba1e183e73c7
#
# Required IAM permissions:
#   ec2:DescribeInstances, ec2:DescribeAddresses, ec2:AllocateAddress,
#   ec2:AssociateAddress, ec2:CreateTags
#
# After the script prints the new public IPv4, update the Cloudflare A record:
#   api.velismail.online  A  <new-ip>  (Proxy status: DNS only)
#
set -euo pipefail

INSTANCE_ID="${1:-${INSTANCE_ID:-}}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

command -v aws >/dev/null 2>&1 \
  || fail "AWS CLI v2 is required: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"

aws sts get-caller-identity >/dev/null 2>&1 \
  || fail "no AWS credentials found (run 'aws configure', use SSO, or use AWS CloudShell)"

imds_get() {
  local path="$1" token
  token=$(curl -fsS -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)
  curl -fsS -H "X-aws-ec2-metadata-token: ${token}" \
    "http://169.254.169.254/latest/meta-data/${path}" 2>/dev/null || true
}

if [[ -z "$INSTANCE_ID" ]]; then
  INSTANCE_ID=$(imds_get instance-id)
fi
[[ -n "$INSTANCE_ID" ]] \
  || fail "instance id not provided and IMDS is not reachable; usage: $0 i-0123456789abcdef0"

if [[ -z "$REGION" ]]; then
  AZ=$(imds_get placement/availability-zone)
  [[ -n "$AZ" ]] && REGION="${AZ%?}"
fi
REGION="${REGION:-us-east-1}"

printf 'instance: %s\nregion:   %s\n' "$INSTANCE_ID" "$REGION"

STATE=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].State.Name' --output text)
[[ "$STATE" == "running" ]] \
  || fail "instance $INSTANCE_ID is '$STATE'; start it before associating an Elastic IP"

# Reuse an address that is already attached to this instance.
EXISTING_ALLOC=$(aws ec2 describe-addresses --region "$REGION" \
  --filters "Name=instance-id,Values=${INSTANCE_ID}" \
  --query 'Addresses[0].AllocationId' --output text)
if [[ -n "$EXISTING_ALLOC" && "$EXISTING_ALLOC" != "None" ]]; then
  IP=$(aws ec2 describe-addresses --region "$REGION" \
    --allocation-ids "$EXISTING_ALLOC" --query 'Addresses[0].PublicIp' --output text)
  printf 'Elastic IP already associated: allocation=%s public-ip=%s\n' "$EXISTING_ALLOC" "$IP"
  printf '\nUpdate Cloudflare: api.velismail.online  A  %s  (DNS only)\n' "$IP"
  exit 0
fi

# Reuse an unassociated VelisMail-tagged address, if one exists.
UNASSOCIATED_ALLOC=$(aws ec2 describe-addresses --region "$REGION" \
  --filters 'Name=tag:Project,Values=VelisMail' \
  --query 'Addresses[?AssociationId==`null`].AllocationId | [0]' --output text)
if [[ -n "$UNASSOCIATED_ALLOC" && "$UNASSOCIATED_ALLOC" != "None" ]]; then
  ALLOC_ID="$UNASSOCIATED_ALLOC"
  printf 'reusing unassociated VelisMail Elastic IP: %s\n' "$ALLOC_ID"
else
  ALLOC_ID=$(aws ec2 allocate-address --region "$REGION" --domain vpc \
    --tag-specifications \
    'ResourceType=elastic-ip,Tags=[{Key=Name,Value=velismail-api},{Key=Project,Value=VelisMail}]' \
    --query 'AllocationId' --output text)
  printf 'allocated Elastic IP: %s\n' "$ALLOC_ID"
fi

aws ec2 associate-address --region "$REGION" \
  --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null

IP=$(aws ec2 describe-addresses --region "$REGION" \
  --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)

cat <<EOF

associated $ALLOC_ID -> $INSTANCE_ID
public IPv4: $IP

Next steps:
  1. Cloudflare DNS: api.velismail.online  A  $IP  (Proxy: DNS only / grey cloud)
  2. Wait 1-2 minutes, then verify:
       curl -fsS https://api.velismail.online/health/ready
  3. Caddy will obtain/renew the Let's Encrypt certificate automatically.

The previous auto-assigned public IPv4 is released as soon as the Elastic IP is
associated. Update DNS immediately so API traffic does not fail.
EOF
