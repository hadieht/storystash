#!/usr/bin/env bash
# Publish StoryStash to GitHub and turn on GitHub Pages for /docs.
# Usage: bash tools/publish_github.sh [repo-name]      (default repo: storystash)
# Reads the token from /root/.github-token (never printed). Token needs: repo (classic)
# or fine-grained with Administration + Contents + Pages = read/write.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${1:-storystash}"
TOKEN_FILE="${GITHUB_TOKEN_FILE:-/root/.github-token}"
[ -s "$TOKEN_FILE" ] || { echo "No token in $TOKEN_FILE"; exit 1; }
TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
api() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }

USER_LOGIN=$(api https://api.github.com/user | python3 -c "import sys,json; print(json.load(sys.stdin).get('login',''))")
[ -n "$USER_LOGIN" ] || { echo "Token rejected by GitHub"; exit 1; }
echo "Signed in as $USER_LOGIN"

code=$(api -o /dev/null -w '%{http_code}' "https://api.github.com/repos/$USER_LOGIN/$REPO")
if [ "$code" = 404 ]; then
  api -X POST https://api.github.com/user/repos -d "{\"name\":\"$REPO\",\"description\":\"StoryStash – Story & Post Saver: Chrome extension that saves Instagram stories, photos and videos in the largest size, named by username and date.\",\"homepage\":\"https://$USER_LOGIN.github.io/$REPO/\",\"private\":false,\"has_issues\":true,\"has_wiki\":false}" >/dev/null
  echo "Created repo $USER_LOGIN/$REPO"
else
  echo "Repo $USER_LOGIN/$REPO already exists (HTTP $code) – pushing to it"
fi

# fill the real URLs into the listing before pushing
PAGES="https://$USER_LOGIN.github.io/$REPO"
sed -i "s#https://<github-username>.github.io/<repo>/privacy.html#$PAGES/privacy.html#; s#https://<github-username>.github.io/<repo>/#$PAGES/#" CHROMEWEBSTORE.md
sed -i "s#(or the GitHub Issues page once the repo exists)#or https://github.com/$USER_LOGIN/$REPO/issues#" CHROMEWEBSTORE.md
git add -A
git commit -qm "Listing: real privacy policy and homepage URLs" || true

git -c credential.helper= -c "http.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" \
  push -q "https://github.com/$USER_LOGIN/$REPO.git" main
echo "Pushed main"

# GitHub Pages from main:/docs
api -X POST "https://api.github.com/repos/$USER_LOGIN/$REPO/pages" -d '{"source":{"branch":"main","path":"/docs"}}' >/dev/null || true
echo "Pages requested – waiting for $PAGES/privacy.html"
for i in $(seq 1 40); do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$PAGES/privacy.html")
  [ "$c" = 200 ] && { echo "LIVE: $PAGES/privacy.html"; exit 0; }
  sleep 15
done
echo "Pages not live yet (last HTTP $c) – it can take a few more minutes."
