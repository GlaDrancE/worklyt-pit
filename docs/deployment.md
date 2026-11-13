# Deploy TrackRush

## Recommended setup

Use **Cloudflare Pages** for the game and your **Oracle Cloud Always Free VM** for the multiplayer relay. Pages serves the static game without a sleeping-service cold start; the VM keeps the relay online. The relay uses very little CPU and RAM.

You need a public hostname for the relay so it can use trusted HTTPS/WSS. Use a domain you own, or create a free [DuckDNS](https://www.duckdns.org/) subdomain and point it to your VM's public IP. In the examples below, replace `relay.example.com` with that hostname.

> Oracle Always Free compute is subject to capacity and idle-instance reclamation. Keep a backup of the relay data (step 7); Always Free does not guarantee that an instance can never be reclaimed.

## 1. Create the Oracle VM

In the Oracle Cloud Console, create a compute instance with:

- **Image:** Ubuntu 24.04
- **Shape:** `VM.Standard.A1.Flex`, 1 OCPU and 6 GB memory
- **Network:** public subnet, public IPv4 address, and an internet gateway
- **Boot volume:** 50 GB
- **SSH:** add your public SSH key and save the matching private key securely

Before creating it, check that the shape and boot volume are marked **Always Free eligible** and that your tenancy's total A1 allocation stays within its free allowance (2 OCPUs, 12 GB memory, and 200 GB block storage). Don't enable paid upgrades or select paid resources.

In the subnet's security list or the instance's network security group, add ingress rules:

| Protocol | Port | Source |
| --- | ---: | --- |
| TCP | 22 | Your current public IP `/32` |
| TCP | 80 | `0.0.0.0/0` |
| TCP | 443 | `0.0.0.0/0` |

Do not open port `8787` to the internet; Caddy will proxy the relay locally.

## 2. Point a hostname at the VM

At your DNS provider, create an **A** record for `relay.example.com` pointing to the VM's public IPv4 address. With DuckDNS, register a subdomain and set its IP to the VM's public IPv4 address. If using Cloudflare DNS, leave this record **DNS only** (gray cloud) for the simplest certificate setup. Wait until the hostname resolves to the VM before continuing.

If you don't have a domain, the DuckDNS hostname avoids a domain purchase, but it is provided by a third party. A public hostname is necessary for the browser to trust the relay's WSS certificate.

## 3. Install Docker and Caddy

SSH into the VM as `ubuntu`, then run:

```bash
sudo apt update
sudo apt install -y docker.io git
sudo systemctl enable --now docker

sudo apt install --yes debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Allow the same ports through Ubuntu's firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

If asked to confirm enabling UFW, answer `y`.

## 4. Start the relay with persistent storage

Clone the GitHub repository and build the relay image:

```bash
git clone https://github.com/vishal-kushwaha-9912/Track-Rush-F1.git "$HOME/Track-Rush-F1"
cd "$HOME/Track-Rush-F1"
sudo docker build -t trackrush-relay .
sudo mkdir -p /opt/trackrush-data
```

Start the relay container. The bind mount keeps leaderboard and player data on the VM across container updates and restarts:

```bash
sudo docker run -d \
  --name trackrush-relay \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v /opt/trackrush-data:/data \
  trackrush-relay
```

## 5. Enable HTTPS/WSS with Caddy

Replace `relay.example.com` with your hostname:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
EOF

sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy obtains and renews the HTTPS certificate automatically. The DNS record must point to the VM, and ports 80 and 443 must be reachable for this to work.

Check the relay and HTTPS:

```bash
sudo docker ps
sudo docker logs --tail 50 trackrush-relay
curl -fsS https://relay.example.com/
```

The `curl` command should print `TrackRush relay is running.` If it fails, check that the DNS record is correct and both Oracle's network rules and UFW allow ports 80 and 443. Caddy's certificate errors are available with `sudo journalctl -u caddy --no-pager -n 50`.

## 6. Deploy the game to Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git** and select this repository.
2. Set the production branch to `main`.
3. Use these build settings:

   | Setting | Value |
   | --- | --- |
   | Framework preset | Vite (or None) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | Leave unset (repository root) |

4. Add these **Production** environment variables before deploying:

   | Variable | Value |
   | --- | --- |
   | `NODE_VERSION` | `22` |
   | `VITE_RELAY_URL` | `wss://relay.example.com` |

   Replace the relay hostname with yours. `VITE_RELAY_URL` is embedded into the game at build time; it must start with `wss://` and must not end with a slash.
5. Save and deploy. Cloudflare will provide a game URL such as `https://<project>.pages.dev`. Open it and confirm the game loads. The spectator page is at `https://<project>.pages.dev/admin.html`.

If you change `VITE_RELAY_URL`, trigger a new Pages deployment so the game is rebuilt with the new address.

## 7. Verify and maintain

- Open the Pages game URL over HTTPS and start a multiplayer session. Open the same URL in a second browser/device to verify both players join.
- If the game cannot connect, check `sudo docker logs --tail 100 trackrush-relay`, verify `curl -fsS https://relay.example.com/` succeeds, and confirm the Pages build used the exact `wss://` hostname.
- Back up player and leaderboard data occasionally:

  ```bash
  sudo tar -czf "$HOME/trackrush-data-backup.tgz" -C /opt trackrush-data
  ```

- To deploy relay updates, run this from the cloned repository after pushing the update to GitHub. Building first leaves the existing relay running if the image build fails:

  ```bash
  cd "$HOME/Track-Rush-F1"
  git pull --ff-only
  sudo docker build -t trackrush-relay .
  sudo docker rm -f trackrush-relay
  sudo docker run -d \
    --name trackrush-relay \
    --restart unless-stopped \
    -p 127.0.0.1:8787:8787 \
    -v /opt/trackrush-data:/data \
    trackrush-relay
  ```

  Cloudflare Pages deploys the game automatically when changes are pushed to `main`.

## If you don't want to manage a VM

Use Render for the relay instead: its free service provides HTTPS/WSS, but may sleep when idle and delay the first connection. The rest of the Pages setup is the same; set `VITE_RELAY_URL` to the Render relay URL and redeploy. Render's free filesystem is ephemeral, so use the Cloudflare D1 data store described in [Player data](data-storage.md) if you need player backups to survive restarts.

## Official references

- [Oracle Always Free resources and idle-instance policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle network security rules](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securityrules.htm)
- [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [DuckDNS setup](https://www.duckdns.org/install.jsp)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy Ubuntu installation](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
