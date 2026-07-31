#!/usr/bin/env python3
"""用 GitHub REST API 多级 tree 推送代码"""
import os, json, base64, urllib.request, urllib.error

TOKEN = None
with open("/home/admin/.openclaw/.env") as f:
    for line in f:
        if line.startswith("export GITHUB_TOKEN="):
            TOKEN = line.split('"')[1]
if not TOKEN: raise SystemExit("无token")

REPO = "zephayer/lightrainbow"
BRANCH = "master"
BASE = "/home/admin/.openclaw/workspace/package-calculator"

def api(path, method="GET", data=None):
    url = f"https://api.github.com/repos/{REPO}/{path}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "openclaw-api")
    body = json.dumps(data).encode() if data is not None else None
    try:
        with urllib.request.urlopen(req, body, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "msg": e.read().decode()[:500]}

def list_files(dirp):
    out = []
    for root, dirs, files in os.walk(dirp):
        dirs[:] = [d for d in dirs if d != '.git']
        for fn in files:
            out.append(os.path.relpath(os.path.join(root, fn), BASE))
    return sorted(out)

# 1. ref 和 base commit
ref = api(f"git/refs/heads/{BRANCH}")
base_sha = ref["object"]["sha"]
print(f"base: {base_sha[:8]}")
base_commit = api(f"git/commits/{base_sha}")

# 2. 收集文件 + 创建 blob
all_files = list_files(BASE)
print(f"files: {len(all_files)}")
blob_shas = {}
for fn in all_files:
    with open(os.path.join(BASE, fn), "rb") as f:
        content = f.read()
    r = api("git/blobs", "POST", {"content": base64.b64encode(content).decode(), "encoding": "base64"})
    blob_shas[fn] = r["sha"]
print(f"blobs: {len(blob_shas)} done")

# 3. 构建路径树（dict of dicts）
from collections import defaultdict
tree_root = {}  # name -> dict(subtree) or None(for file)
for fn in all_files:
    parts = fn.split("/")
    cur = tree_root
    for i, part in enumerate(parts[:-1]):
        if part not in cur:
            cur[part] = {}
        cur = cur[part]
    cur[parts[-1]] = fn  # 存完整路径

# 4. 递归创建 tree（返回 tree sha）
def create_tree(node):
    entries = []
    for name in sorted(node):
        val = node[name]
        if isinstance(val, str):
            # 文件: val 是 blob_shas 的 key
            entries.append({"path": name, "mode": "100644", "type": "blob", "sha": blob_shas[val]})
        else:
            # 目录
            sub_sha = create_tree(val)
            entries.append({"path": name, "mode": "040000", "type": "tree", "sha": sub_sha})
    r = api("git/trees", "POST", {"tree": entries})
    return r["sha"]

root_sha = create_tree(tree_root)
print(f"root tree: {root_sha}")

# 5. commit
import datetime
ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
commit = api("git/commits", "POST", {
    "message": f"feat: 总包计算器 v1 + GitHub Pages 自动部署 ({ts})",
    "tree": root_sha,
    "parents": [base_sha]
})
commit_sha = commit["sha"]
print(f"commit: {commit_sha[:8]}")

# 6. update ref
u = api(f"git/refs/heads/{BRANCH}", "PATCH", {"sha": commit_sha, "force": False})
print("push:", "✅ OK" if "error" not in u else f"❌ {u['msg']}")
