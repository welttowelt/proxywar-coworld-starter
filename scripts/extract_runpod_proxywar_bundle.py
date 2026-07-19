#!/usr/bin/env python3
"""Safely extract a ProxyWar RunPod bundle using only the Python standard library."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import sys
import tarfile
from typing import BinaryIO


BUNDLE_ROOT = "proxywar-runpod-bundle"
DEFAULT_MAX_COMPRESSED_BYTES = 1_073_741_824
DEFAULT_MAX_EXPANDED_BYTES = 4_294_967_296
DEFAULT_MAX_MEMBERS = 250_000
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class UnsafeArchiveError(RuntimeError):
    """Raised when an archive violates the extraction contract."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_member_name(name: str) -> str:
    if not name or "\x00" in name or "\\" in name:
        raise UnsafeArchiveError(f"invalid archive path: {name!r}")
    pure = PurePosixPath(name)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        raise UnsafeArchiveError(f"non-canonical archive path: {name!r}")
    normalized = pure.as_posix()
    if normalized != name:
        raise UnsafeArchiveError(f"non-canonical archive path: {name!r}")
    if pure.parts[0] != BUNDLE_ROOT:
        raise UnsafeArchiveError(
            f"archive member is outside the single {BUNDLE_ROOT} root: {name!r}"
        )
    return normalized


def validate_symlink_target(member_name: str, target: str) -> None:
    if not target or "\x00" in target or "\\" in target:
        raise UnsafeArchiveError(f"invalid symlink target for {member_name!r}")
    if PurePosixPath(target).is_absolute():
        raise UnsafeArchiveError(f"absolute symlink target for {member_name!r}")
    resolved = posixpath.normpath(
        posixpath.join(posixpath.dirname(member_name), target)
    )
    if resolved != BUNDLE_ROOT and not resolved.startswith(f"{BUNDLE_ROOT}/"):
        raise UnsafeArchiveError(
            f"symlink resolves outside {BUNDLE_ROOT}: {member_name!r} -> {target!r}"
        )


def preflight_archive(
    archive_path: Path,
    *,
    expected_sha256: str,
    max_compressed_bytes: int = DEFAULT_MAX_COMPRESSED_BYTES,
    max_expanded_bytes: int = DEFAULT_MAX_EXPANDED_BYTES,
    max_members: int = DEFAULT_MAX_MEMBERS,
) -> dict[str, object]:
    if not SHA256_RE.fullmatch(expected_sha256):
        raise UnsafeArchiveError("expected SHA-256 must be 64 lowercase hex characters")
    info = archive_path.stat()
    if not archive_path.is_file():
        raise UnsafeArchiveError("archive path is not a regular file")
    if info.st_size <= 0 or info.st_size > max_compressed_bytes:
        raise UnsafeArchiveError(
            f"compressed archive size {info.st_size} exceeds allowed range"
        )
    actual_sha256 = sha256_file(archive_path)
    if actual_sha256 != expected_sha256:
        raise UnsafeArchiveError(
            f"archive SHA-256 mismatch: expected {expected_sha256}, got {actual_sha256}"
        )

    paths: dict[str, str] = {}
    symlinks: list[str] = []
    expanded_bytes = 0
    member_count = 0
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            for member in archive:
                member_count += 1
                if member_count > max_members:
                    raise UnsafeArchiveError(
                        f"archive member count exceeds {max_members}"
                    )
                name = normalize_member_name(member.name)
                if name in paths:
                    raise UnsafeArchiveError(f"duplicate archive path: {name!r}")
                if member.islnk():
                    raise UnsafeArchiveError(f"hardlink is forbidden: {name!r}")
                if member.isfile():
                    kind = "file"
                    if member.size < 0:
                        raise UnsafeArchiveError(f"negative file size: {name!r}")
                    expanded_bytes += member.size
                    if expanded_bytes > max_expanded_bytes:
                        raise UnsafeArchiveError(
                            "declared expanded size exceeds the configured cap"
                        )
                elif member.isdir():
                    kind = "directory"
                elif member.issym():
                    kind = "symlink"
                    validate_symlink_target(name, member.linkname)
                    symlinks.append(name)
                else:
                    raise UnsafeArchiveError(
                        f"unsupported archive member type for {name!r}"
                    )
                paths[name] = kind
    except (tarfile.TarError, EOFError) as error:
        raise UnsafeArchiveError(f"invalid gzip/tar archive: {error}") from error

    if member_count == 0:
        raise UnsafeArchiveError("archive is empty")
    for name, kind in paths.items():
        parts = PurePosixPath(name).parts
        for index in range(1, len(parts)):
            ancestor = PurePosixPath(*parts[:index]).as_posix()
            ancestor_kind = paths.get(ancestor)
            if ancestor_kind in ("file", "symlink"):
                raise UnsafeArchiveError(
                    f"{ancestor_kind} used as archive directory: {ancestor!r}"
                )
    for symlink_name in symlinks:
        prefix = f"{symlink_name}/"
        if any(name.startswith(prefix) for name in paths):
            raise UnsafeArchiveError(
                f"symlink has nested archive members: {symlink_name!r}"
            )

    return {
        "archive_sha256": actual_sha256,
        "compressed_bytes": info.st_size,
        "declared_expanded_bytes": expanded_bytes,
        "member_count": member_count,
    }


def copy_member(source: BinaryIO, destination: BinaryIO, limit: int) -> int:
    written = 0
    while True:
        chunk = source.read(1024 * 1024)
        if not chunk:
            return written
        written += len(chunk)
        if written > limit:
            raise UnsafeArchiveError("actual expanded size exceeds the configured cap")
        destination.write(chunk)


def verify_manifest_receipt(bundle_root: Path) -> str:
    manifest_path = bundle_root / "manifest.json"
    receipt_path = bundle_root / "manifest.sha256"
    line = receipt_path.read_text(encoding="utf-8").strip()
    match = re.fullmatch(r"([a-f0-9]{64})  manifest\.json", line)
    if not match:
        raise UnsafeArchiveError("invalid manifest.sha256 receipt")
    actual = sha256_file(manifest_path)
    if actual != match.group(1):
        raise UnsafeArchiveError("manifest.json does not match manifest.sha256")
    return actual


def extract_archive(
    archive_path: Path,
    destination: Path,
    *,
    expected_sha256: str,
    max_compressed_bytes: int = DEFAULT_MAX_COMPRESSED_BYTES,
    max_expanded_bytes: int = DEFAULT_MAX_EXPANDED_BYTES,
    max_members: int = DEFAULT_MAX_MEMBERS,
) -> dict[str, object]:
    if destination.exists() or destination.is_symlink():
        raise UnsafeArchiveError(
            "destination must be a new path; existing paths are refused"
        )
    preflight = preflight_archive(
        archive_path,
        expected_sha256=expected_sha256,
        max_compressed_bytes=max_compressed_bytes,
        max_expanded_bytes=max_expanded_bytes,
        max_members=max_members,
    )
    destination.mkdir(parents=False, mode=0o700)
    actual_expanded_bytes = 0
    directory_modes: list[tuple[Path, int]] = []
    symlink_members: list[tarfile.TarInfo] = []
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            for member in archive:
                name = normalize_member_name(member.name)
                target_path = destination.joinpath(*PurePosixPath(name).parts)
                if member.issym():
                    symlink_members.append(member)
                    continue
                if member.isdir():
                    target_path.mkdir(parents=True, exist_ok=True, mode=0o700)
                    directory_modes.append((target_path, member.mode & 0o777))
                    continue
                if not member.isfile():
                    raise UnsafeArchiveError(
                        f"unsupported member changed after preflight: {name!r}"
                    )
                target_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                source = archive.extractfile(member)
                if source is None:
                    raise UnsafeArchiveError(f"cannot read archive member: {name!r}")
                with source, target_path.open("xb") as output:
                    written = copy_member(
                        source,
                        output,
                        max_expanded_bytes - actual_expanded_bytes,
                    )
                if written != member.size:
                    raise UnsafeArchiveError(
                        f"archive member size mismatch: {name!r}"
                    )
                actual_expanded_bytes += written
                os.chmod(target_path, member.mode & 0o777)
        for member in symlink_members:
            name = normalize_member_name(member.name)
            validate_symlink_target(name, member.linkname)
            target_path = destination.joinpath(*PurePosixPath(name).parts)
            target_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if target_path.exists() or target_path.is_symlink():
                raise UnsafeArchiveError(f"symlink path already exists: {name!r}")
            os.symlink(member.linkname, target_path)
        for directory, mode in reversed(directory_modes):
            os.chmod(directory, mode)
        if actual_expanded_bytes != preflight["declared_expanded_bytes"]:
            raise UnsafeArchiveError("actual and declared expanded sizes differ")
        bundle_root = destination / BUNDLE_ROOT
        manifest_sha256 = verify_manifest_receipt(bundle_root)
        final_archive_sha256 = sha256_file(archive_path)
        if final_archive_sha256 != expected_sha256:
            raise UnsafeArchiveError(
                "archive changed between preflight and completed extraction"
            )
    except Exception:
        shutil.rmtree(destination)
        raise

    return {
        "status": "extracted",
        **preflight,
        "actual_expanded_bytes": actual_expanded_bytes,
        "final_archive_sha256": final_archive_sha256,
        "manifest_sha256": manifest_sha256,
        "bundle_root": str(bundle_root.resolve()),
    }


def positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be a positive integer")
    return parsed


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Verify and safely extract one ProxyWar RunPod tar.gz bundle. "
            "The expected SHA-256 must come from the out-of-band Odin handoff."
        )
    )
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument(
        "--max-compressed-bytes",
        type=positive_integer,
        default=DEFAULT_MAX_COMPRESSED_BYTES,
    )
    parser.add_argument(
        "--max-expanded-bytes",
        type=positive_integer,
        default=DEFAULT_MAX_EXPANDED_BYTES,
    )
    parser.add_argument(
        "--max-members",
        type=positive_integer,
        default=DEFAULT_MAX_MEMBERS,
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        result = extract_archive(
            args.archive.resolve(),
            args.destination.resolve(),
            expected_sha256=args.expected_sha256,
            max_compressed_bytes=args.max_compressed_bytes,
            max_expanded_bytes=args.max_expanded_bytes,
            max_members=args.max_members,
        )
    except (OSError, UnsafeArchiveError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
