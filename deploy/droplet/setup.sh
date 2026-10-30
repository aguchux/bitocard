#!/bin/sh
# One-time setup of a fresh Ubuntu 24.04 droplet for the API. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/aguchux/bitocard/main/deploy/droplet/setup.sh -o setup.sh
#   sh setup.sh "<the CI deploy key's public key>"
# Installs Docker, creates the `deploy` user CI connects as, the folders the API uses, a swap file, automatic security
# updates and SSH hardening. Safe to run again. Runbook: deploy/droplet/README.md.
set -eu

DEPLOY_KEY="${1:?usage: setup.sh \"<CI deploy public key>\"}"

timedatectl set-timezone UTC

echo "[setup] packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl unattended-upgrades fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
  echo "[setup] Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "[setup] deploy user"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$DEPLOY_KEY" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$DEPLOY_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

echo "[setup] folders"
install -d -m 755 -o deploy -g deploy /opt/bitocard
# Secrets: readable by the deploy user (who runs the containers) and root only.
install -d -m 700 -o deploy -g deploy /etc/bitocard /etc/bitocard/certs
[ -f /etc/bitocard/api.env ] || install -m 600 -o deploy -g deploy /dev/null /etc/bitocard/api.env
# Udozo's API (docs/UDOZO_SPINOFF_PLAN.md): its secrets beside BitoCard's. The file is made empty only when Udozo is set
# up (README.md, Udozo), since its presence switches Udozo's API on at the next deploy.
install -d -m 700 -o deploy -g deploy /etc/udozo

if [ ! -f /swapfile ]; then
  echo "[setup] 2 GB swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Swap only under real pressure, never as working memory.
echo 'vm.swappiness=10' > /etc/sysctl.d/90-bitocard.conf
sysctl -q --system

echo "[setup] SSH: keys only, no root password logins"
cat > /etc/ssh/sshd_config.d/90-bitocard.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
# Ubuntu 24.04 starts sshd per connection (ssh.socket), which reads this at once; older releases need a reload.
systemctl try-reload-or-restart ssh.service 2>/dev/null || true

echo "[setup] done. Next (README.md): fill /etc/bitocard/api.env, add the Cloudflare origin certificate to /etc/bitocard/certs, attach the DigitalOcean firewall, then deploy from CI."
