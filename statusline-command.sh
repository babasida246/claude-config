#!/usr/bin/env bash
# Claude Code statusLine: model | cwd | git branch | context usage | rate limits
input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name')
dir=$(echo "$input" | jq -r '.workspace.current_dir')
cwd=$(basename "$dir")

branch=""
if git -C "$dir" --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$dir" --no-optional-locks branch --show-current 2>/dev/null)
fi

used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx=""
[ -n "$used" ] && ctx=$(printf '%.0f' "$used")

five=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
rate=""
[ -n "$five" ] && rate="5h:$(printf '%.0f' "$five")%"
if [ -n "$week" ]; then
  wk="7d:$(printf '%.0f' "$week")%"
  if [ -n "$rate" ]; then rate="$rate $wk"; else rate="$wk"; fi
fi

# Colors (kept dim-friendly since Claude Code renders the status line dimmed)
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
MAGENTA='\033[35m'
DIM='\033[2m'
RESET='\033[0m'

out="${CYAN}${model}${RESET}"
out="$out ${DIM}|${RESET} ${GREEN}${cwd}${RESET}"
if [ -n "$branch" ]; then
  out="$out ${DIM}|${RESET} ${YELLOW}${branch}${RESET}"
fi
if [ -n "$ctx" ]; then
  out="$out ${DIM}|${RESET} ${MAGENTA}ctx ${ctx}%${RESET}"
fi
if [ -n "$rate" ]; then
  out="$out ${DIM}|${RESET} ${DIM}${rate}${RESET}"
fi

printf "%b" "$out"
