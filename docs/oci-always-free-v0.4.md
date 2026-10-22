# Oracle Cloud Always Free: FluxDesk v0.4 staging VM

**Date verified:** 22 October 2026  
**Deployment:** one Arm64 Ubuntu VM, separate persistent block volume, Caddy HTTPS,
Node API behind a token-authenticated Vercel gateway. **No exchange execution.**

OCI account signup, payment-card verification, VM launch, SSH key creation and
DNS ownership require **the account owner's explicit actions**. ChatGPT has
no authorized OCI infrastructure connector and cannot create those resources.

## 1. Stay inside Oracle Always Free

Official current documentation:

- [Oracle Always Free quotas](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Free Tier signup, card authorization and limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [Create compute instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm)
- [Ubuntu SSH login](https://docs.oracle.com/en-us/iaas/Content/Compute/References/bestpracticescompute.htm)
- [Official Docker Ubuntu/Arm64 install](https://docs.docker.com/engine/install/ubuntu/)

As of 2026, the permanent Always Free **Ampere A1** allowance is
**1,500 OCPU-hours + 9,000 GB-hours / month**, equivalent to **2 OCPUs and
12 GB memory** continuously for Always Free tenancies. The account's home
region has **200 GB** combined boot/block storage and five eligible backups.
This *includes*, rather than adds to, the boot volume. An Always Free
instance must be in the tenancy's **home region**.

**Recommended initial allocation:** one `VM.Standard.A1.Flex` with
**1 OCPU, 6 GB RAM**, **50 GB boot** and a **separate 50 GB block volume**,
giving 100 GB total allocated and space within the free quota. The extra
data disk lets research files survive VM replacement if the boot disk is
deleted. The VM/volume must show **Always Free Eligible** or cost estimate
$0 before confirmation.

**Caveats:** credit-card verification is ordinarily required even for a
free account. Oracle states it doesn't charge the card unless you upgrade,
but *do not choose a paid shape, paid image, paid support, or subscription*.
Free A1 capacity may be unavailable in the home region or availability
domain. If the console shows 'out of host capacity', try another AD or wait;
do NOT upgrade. Oracle may reclaim idle Always Free VMs under its documented
7-day CPU/network/memory thresholds. Never run dummy CPU load to defeat
reclamation. Offsite backups still matter.

## 2. Create the tenancy and VM using the OCI Console

1. Create a [Free Tier account](https://www.oracle.com/cloud/free/) and sign
   into [OCI Console](https://cloud.oracle.com/). Select a nearby, appropriate
   **home region** during signup. Always Free VM and block volumes must live
   there. Make sure `VM.Standard.A1.Flex` is offered. The region cannot
   simply be changed later to escape free-capacity shortages.
2. Under **Compute → Instances**, choose **Create instance**. Display name:
   `fluxdesk-oci-staging`. Use a dedicated `fluxdesk` compartment if you
   are comfortable with OCI IAM; otherwise the default compartment works
   for initial setup.
3. **Image:** Canonical Ubuntu **24.04 LTS arm64**, marked Always Free
   Eligible. **Shape:** Ampere `VM.Standard.A1.Flex`, **1 OCPU, 6 GB**.
   Do not select `A2` or a paid AMD/Intel flexible shape.
4. **Networking:** create/use an ordinary VCN and **public subnet** with
   an internet gateway; assign a **public IPv4** for HTTPS and SSH. Prefer a
   network security group restricted to just the VM.
5. **SSH authentication:** supply a new `ssh-ed25519` public key, or
   download Oracle's private key to your Mac. Keep the **private key local**,
   with `chmod 600`. Do not share it in chats, screenshots or GitHub.
6. **Boot volume:** leave 50 GB default (or use the nearest Always Free
   eligible option displayed). Review the page: 1 A1 OCPU, 6 GB RAM,
   50 GB boot, always-free-eligible image, public IP and **no paid upgrades**.
   Only then create the VM.

### Network ingress rules

In **Networking → VCN → subnet/security list or network security group** add
inbound TCP *stateful* rules:

| Destination port | Source | Purpose |
| --- | --- | --- |
| 22 | **YOUR_CURRENT_PUBLIC_IPV4/32** only | SSH admin |
| 80 | `0.0.0.0/0` | ACME HTTP-01 validation and redirect |
| 443 | `0.0.0.0/0` | HTTPS Vercel → Caddy |

Do **not** allow ingress on **8787**, database ports or Docker management
ports. Keep normal outbound HTTPS/DNS permitted for Binance/Hyperliquid
and updates. If SSH stops working after your IP changes, update only the
source IP range for 22. Verify OS firewall and VCN security rules agree.

Connect from your Mac with the private key you generated or downloaded:

```sh
chmod 600 ~/.ssh/fluxdesk-oci.key
ssh -i ~/.ssh/fluxdesk-oci.key ubuntu@YOUR_VM_PUBLIC_IPV4
```

The documented Ubuntu platform image username is `ubuntu`; Oracle Linux
uses `opc`. Never share the private key.

## 3. Add a **separate** 50 GB Always Free data block volume

This part is **not optional** for v0.4 cloud startup.

1. In **Storage → Block Storage → Block Volumes**, click **Create Block Volume**.
   Name: `fluxdesk-research-data`, size: **50 GB**, **same home region and
   availability domain as the VM**. Check its Always Free eligibility.
2. Open your VM's details → **Attached Block Volumes** → **Attach Block
   Volume**; select the new volume. Use **Paravirtualized** if supported.
   Do not detach the VM's boot volume.
3. SSH into Ubuntu and inspect disks using `lsblk -f` and
   `lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS`. Identify the **new,
   unformatted** volume using size/attachment information from OCI.
   **Never assume the device is /dev/sdb or /dev/vdb.** A mistaken
   `mkfs` can irreversibly delete the boot disk.
4. Only after confirming the correct, empty additional disk, substitute its
   actual device path in the following commands:

```sh
# DANGEROUS IF USED ON THE WRONG DISK. VERIFY FIRST WITH lsblk.
sudo mkfs.ext4 -L fluxdesk-research /dev/THE_NEW_DATA_DISK
sudo mkdir -p /srv/fluxdesk
sudo blkid /dev/THE_NEW_DATA_DISK
# Copy the real UUID from blkid. Put ONE line in /etc/fstab:
# UUID=YOUR_DATA_UUID /srv/fluxdesk ext4 defaults,nofail 0 2
sudoedit /etc/fstab
sudo mount /srv/fluxdesk
findmnt --mountpoint /srv/fluxdesk
id -u ubuntu
# Docker's non-root Node process is UID:GID 1000:1000.
sudo install -d -m 0700 -o 1000 -g 1000 /srv/fluxdesk/data
```

Check `findmnt --fstab --mountpoint /srv/fluxdesk` after editing so
the data disk remounts on reboot. The app's OCI preflight and in-container
startup guard both **refuse to start** on unmounted/ephemeral storage.
Filesystem initialization is a one-time step; never reformat a volume that
already contains research data.

## 4. Install Docker Engine for Ubuntu 24.04 Arm64

Follow the [official Ubuntu Engine instructions](https://docs.docker.com/engine/install/ubuntu/).
This is a compact version for a clean VM; do not execute blindly on a
machine with an existing container runtime.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker compose version
```

Avoid putting the `ubuntu` account in the `docker` group: that group
confers effective root privileges. Use `sudo docker ...`.

## 5. Deploy the **v0.4 branch**, not main

After the block disk is mounted and Docker installed:

```sh
git clone https://github.com/TheooAndre/fluxdesk.git
cd fluxdesk
git fetch origin
git switch --track origin/feat/cloud-foundation-v0.4
cp deploy/vps/.env.example deploy/vps/.env
chmod 600 deploy/vps/.env
```

Generate a random 32-byte (64 hex character) gateway secret:

```sh
openssl rand -hex 32
```

Enter the secret only in `deploy/vps/.env` on the VM and in **Vercel's
server-side Preview environment** under the same
`FLUXDESK_GATEWAY_TOKEN` name. NEVER prefix it `VITE_`; never paste
it into chat or commit it. Also set `FLUXDESK_BACKEND_DOMAIN` to the
real DNS hostname you own/control, without `https://`.

The hostname needs an A record pointing to this VM's public IPv4;
Caddy obtains and renews the TLS certificate after DNS propagates and
ports 80/443 are reachable. Do not configure Vercel's upstream URL
until the VM's endpoint presents a valid HTTPS certificate.

Before starting any application container:

```sh
bash deploy/oci/verify-host.sh
sudo docker compose --env-file deploy/vps/.env \
  -f deploy/vps/compose.yaml -f deploy/oci/compose.oci.yaml config --quiet
```

`verify-host.sh` checks Ubuntu A1, the mounted separate filesystem,
`/etc/fstab` persistence, UID 1000 volume ownership, safe secret
permissions and the Docker volume's backing path. It does **not** format
disks or change files. If it reports a failure, stop instead of bypassing it.

Start staging only after verifying all prerequisites:

```sh
sudo docker compose --env-file deploy/vps/.env \
  -f deploy/vps/compose.yaml -f deploy/oci/compose.oci.yaml \
  up -d --build
sudo docker compose --env-file deploy/vps/.env \
  -f deploy/vps/compose.yaml -f deploy/oci/compose.oci.yaml \
  ps
```

Do not run multiple replicas. Never use `docker compose down -v`
because `-v` deletes named volumes.

## 6. Check the private backend through HTTPS

Once Caddy TLS is valid, direct anonymous requests must fail:

```sh
curl --fail-with-body -i https://YOUR_BACKEND_DNS/api/health
# Expected HTTP 401 JSON: "Gateway authentication required"
```

The unauthorized `401` is the *correct* result. Do not send the secret
from your Mac to test the public API. Check authorized health locally
through the container's healthcheck instead.

In the **existing protected Vercel project**, set Preview-only,
server-side variables:

- `FLUXDESK_BACKEND_URL=https://YOUR_BACKEND_DNS/`
- `FLUXDESK_GATEWAY_TOKEN=` the matching secret (stored privately)

Redeploy only the `feat/cloud-foundation-v0.4` Preview branch. From an
authenticated Vercel session, `/api/health` should return 200 JSON.
Then check live market data, historical dataset fetch, read-only
backtesting, trading-cost disclosures and 401/403 origin protections.

## 7. Verify persistence and backup before using it

Create and archive a harmless research dataset through Strategy Lab;
record its **nonsecret dataset SHA-256 ID**. Restart only the backend
container, then verify the same ID still exists. Because the Docker named
volume is bound to the OCI attached block filesystem, the data survives
container replacement *and* ordinary VM reboots, provided the block disk
is reattached and mounted.

```sh
sudo FLUXDESK_BACKUP_DIR=/var/backups/fluxdesk bash deploy/vps/backup.sh
```

This local tar.gz is a *snapshot*, not independent disaster recovery.
Encrypt a copy stored outside OCI and test a restore. OCI's Always Free
allocation also includes up to **five volume backup resources** in the
home region, subject to quota and retention limits. See the official
Block Volume backups documentation.

**Do not run production trading execution**. We have only a
research-only single-user app. Do not merge v0.4 until authenticated
cloud/iPhone validation, durability and recovery checks pass.

## Troubleshooting / stop conditions

- **No A1 capacity:** try another available AD in home region or wait;
  no forced paid upgrade.
- **No free data disk:** check the home region and combined 200 GB quota,
  pause rather than create paid volume.
- **`verify-host.sh` says unmounted:** do not bypass. Inspect `lsblk`,
  `findmnt`, `/etc/fstab` and volume attachment in OCI Console.
- **HTTP 401 on direct backend:** expected. HTTP 200 on direct unauthenticated
  endpoint is a security failure.
- **HTTPS/TLS fails:** check DNS, VM public IP, security list/NSG ingress
  80/443, Ubuntu host firewall and Caddy logs.
- **App doesn't start:** inspect Docker logs, but never paste environment
  variables or gateway credentials in public diagnostics.
- **Costs > $0, paid shape, A2, oversized disk or unknown option:** stop.
  Do not activate without explicit agreement from the owner.
