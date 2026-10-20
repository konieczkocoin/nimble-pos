#!/usr/bin/env python3
"""Create and restore-check a complete source checkpoint; never deletes older copies."""
import argparse
import hashlib
import io
import json
import os
import platform
from pathlib import Path
import subprocess
import tempfile
import zipfile


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def checkpoint(repo, output):
    repo = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip())
    output = Path(output).resolve()
    if output == repo or repo in output.parents:
        raise ValueError("Checkpoint must be outside the repository")
    if git(repo, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Commit all intended files first; refusing a checkpoint of a dirty tree")
    if git(repo, "rev-parse", "--is-shallow-repository").strip() == b"true":
        raise ValueError("Full history required; refusing a shallow repository")
    if output.exists():
        raise ValueError("Refusing to overwrite an existing checkpoint")
    sha = git(repo, "rev-parse", "HEAD").decode().strip()
    tree = git(repo, "rev-parse", "HEAD^{tree}").decode().strip()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Temporary files live outside the repository and are private to this run.
    with tempfile.TemporaryDirectory(prefix="nimble-checkpoint-") as work:
        work = Path(work)
        bundle = work / "nimble.bundle"
        git(repo, "bundle", "create", str(bundle), "--all")
        git(repo, "bundle", "verify", str(bundle))
        restored = work / "restored"
        subprocess.run(["git", "clone", "--quiet", str(bundle), str(restored)], check=True)
        git(restored, "fsck", "--full")
        if git(restored, "rev-parse", "HEAD").decode().strip() != sha:
            raise ValueError("Restored HEAD does not match the checkpoint")
        if git(restored, "rev-parse", "HEAD^{tree}").decode().strip() != tree:
            raise ValueError("Restored source tree does not match the checkpoint")
        source = git(repo, "archive", "--format=zip", "--prefix=source/", sha)
        evidence_path = "docs/product/recovery-implementation-running.md"
        evidence = git(repo, "show", f"{sha}:{evidence_path}")
        migrations = []
        for line in git(repo, "ls-tree", "-r", sha, "apps/api/drizzle").decode().splitlines():
            metadata, path = line.split("\t", 1)
            if path.endswith(".sql"):
                migrations.append({"path": path, "git_blob": metadata.split()[2]})
        manifest = {
            "project_repository": "https://github.com/konieczkocoin/nimble-pos",
            "commit": sha,
            "tree": tree,
            "branch": git(repo, "branch", "--show-current").decode().strip(),
            "bundle_sha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
            "restore_check": "fresh clone, matching HEAD/tree, git fsck --full passed",
            "migrations": migrations,
            "test_results_and_open_gates": evidence_path,
            "evidence_sha256": hashlib.sha256(evidence).hexdigest(),
            "checkpoint_environment": {"python": platform.python_version(), "system": platform.system(), "git": git(repo, "--version").decode().strip()},
            "scope": "All tracked sources and reachable Git history; excludes dependencies, credentials, live database and media",
            "durable_save": "Upload this whole archive to persistent storage and record the confirmed file identity before declaring the work secured",
        }
        archive = work / "checkpoint.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as target:
            with zipfile.ZipFile(io.BytesIO(source)) as files:
                for item in files.infolist():
                    target.writestr(item, files.read(item.filename))
            target.write(bundle, "nimble.bundle")
            target.writestr("MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
            target.writestr("RESTORE-PL.md", "# Odtworzenie kodu\n\n"
                "Rozpakuj archiwum. Źródła są w source/. Pełna historia jest w nimble.bundle.\n\n"
                "`git clone nimble.bundle nimble`\n\n`git -C nimble fsck --full`\n\n"
                "Porównaj HEAD i drzewo z MANIFEST.json. Następnie w repozytorium: "
                "`corepack pnpm install --frozen-lockfile`.\n\n"
                "To kopia kodu, nie danych lokalu. Wyniki testów i ograniczenia są w "
                "docs/product/recovery-implementation-running.md. "
                "Utworzenie archiwum nie potwierdza jego trwałego przesłania.\n")
        with zipfile.ZipFile(archive) as target:
            if target.testzip() is not None:
                raise ValueError("Archive CRC check failed")
        # Exclusive creation protects an earlier checkpoint even against a race.
        try:
            with output.open("xb") as dest:
                os.chmod(output, 0o600)
                dest.write(archive.read_bytes())
                dest.flush()
                os.fsync(dest.fileno())
        except FileExistsError:
            raise ValueError("Refusing to overwrite an existing checkpoint") from None
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return {**manifest, "archive": str(output), "archive_sha256": digest}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="New .zip path outside the repository")
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parent.parent))
    args = parser.parse_args()
    try:
        print(json.dumps(checkpoint(args.repo, args.output), indent=2))
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Checkpoint failed: {error}\n")
