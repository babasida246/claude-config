# VPS SSH Tool with RTK Optimization

Connect to VPS servers via SSH with RTK-optimized output. Uses `~/.claude/tools/ssh_rtk.py`.

**RTK auto-deploy**: If RTK is not installed on the target VPS, the tool automatically installs it on first command, then retries with RTK. The profile is updated so subsequent commands use RTK directly.

## Workflow

### 1. Ask for connection details

Use AskUserQuestion to ask:
- **VPS**: Show saved profiles from `~/.claude/vps-profiles.json` as options + "New connection"
- If "New connection": ask for IP, username (default: root), auth method (SSH key / Password)
  - SSH key: ask for key path
  - Password: ask for password

### 2. If new connection, offer to save profile

Ask if user wants to save this connection as a profile:
```bash
python ~/.claude/tools/ssh_rtk.py profile add --name "<name>" --ip "<ip>" --user "<user>" --key "<key>"
```
For password auth, use env var:
```bash
SSH_PASSWORD="<password>" python ~/.claude/tools/ssh_rtk.py profile add --name "<name>" --ip "<ip>" --user "<user>" --password "<password>"
```

### 3. Ask what to do on the VPS

Ask the user what command or task they want to run.

### 4. Execute commands

**With profile:**
```bash
python ~/.claude/tools/ssh_rtk.py run --profile "<name>" <command>
```

**With inline credentials (key):**
```bash
python ~/.claude/tools/ssh_rtk.py run --ip "<ip>" --user "<user>" --key "<key>" <command>
```

**With password:**
```bash
SSH_PASSWORD="<password>" python ~/.claude/tools/ssh_rtk.py run --ip "<ip>" --user "<user>" <command>
```

**Without RTK (raw output):**
```bash
python ~/.claude/tools/ssh_rtk.py run --profile "<name>" --no-rtk <command>
```

### 5. Parse and present results

The helper returns JSON:
```json
{
  "stdout": "...",
  "stderr": "...",
  "exit_code": 0,
  "host": "root@1.2.3.4",
  "command": "...",
  "rtk": true,
  "rtk_auto_deployed": true,
  "rtk_version": "rtk 0.42.4"
}
```

- Present `stdout` as the main result
- If `exit_code != 0`, show stderr as error
- If `rtk_auto_deployed`, inform user that RTK was installed on the VPS
- If `rtk_fallback`, note that RTK deploy failed and raw output was used

### 6. Continue or disconnect

After each command, ask if the user wants to run another command or is done.

## RTK Management

**Explicitly deploy RTK to a VPS:**
```bash
python ~/.claude/tools/ssh_rtk.py deploy-rtk --profile "<name>"
python ~/.claude/tools/ssh_rtk.py deploy-rtk --ip "<ip>" --user "<user>" --key "<key>"
```

**Force reinstall:**
```bash
python ~/.claude/tools/ssh_rtk.py deploy-rtk --profile "<name>" --force
```

**Check RTK status:**
```bash
python ~/.claude/tools/ssh_rtk.py check-rtk --profile "<name>"
```

## Profile Management

```bash
python ~/.claude/tools/ssh_rtk.py profile list
python ~/.claude/tools/ssh_rtk.py profile add --name "<n>" --ip "<ip>" --user "<u>" --key "<k>"
python ~/.claude/tools/ssh_rtk.py profile remove --name "<n>"
```

## Security Notes

- Passwords passed via SSH_PASSWORD env var (not CLI argument)
- Use SSH keys when possible (more secure)
- Profile passwords stored in `~/.claude/vps-profiles.json` (local only, gitignored)

## Common VPS Commands

| Task | Command |
|------|---------|
| Service status | `systemctl status <service> --no-pager` |
| View logs | `journalctl -u <service> -n 50 --no-pager` |
| Disk usage | `df -h` |
| Memory | `free -h` |
| Running processes | `ps aux --sort=-%mem` |
| Git pull + deploy | `cd /path && git pull && bash deploy.sh` |
| Check ports | `ss -tlnp` |
| Uptime | `uptime` |
