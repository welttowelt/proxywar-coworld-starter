from __future__ import annotations

import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

from scripts.extract_runpod_proxywar_bundle import (
    UnsafeArchiveError,
    extract_archive,
    preflight_archive,
    sha256_file,
)


def add_file(archive: tarfile.TarFile, name: str, body: bytes) -> None:
    member = tarfile.TarInfo(name)
    member.size = len(body)
    member.mode = 0o644
    archive.addfile(member, io.BytesIO(body))


def create_archive(path: Path, entries: list[tuple[str, str, bytes | str]]) -> None:
    with tarfile.open(path, mode="w:gz") as archive:
        for kind, name, value in entries:
            if kind == "file":
                add_file(archive, name, value)
            elif kind == "symlink":
                member = tarfile.TarInfo(name)
                member.type = tarfile.SYMTYPE
                member.linkname = value
                archive.addfile(member)
            elif kind == "hardlink":
                member = tarfile.TarInfo(name)
                member.type = tarfile.LNKTYPE
                member.linkname = value
                archive.addfile(member)
            else:
                raise AssertionError(kind)


class SafeExtractorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_clean_archive_extracts_and_binds_manifest(self) -> None:
        manifest = b'{"schema_version":1}\n'
        manifest_sha = hashlib.sha256(manifest).hexdigest()
        archive_path = self.root / "clean.tar.gz"
        create_archive(
            archive_path,
            [
                (
                    "file",
                    "proxywar-runpod-bundle/manifest.json",
                    manifest,
                ),
                (
                    "file",
                    "proxywar-runpod-bundle/manifest.sha256",
                    f"{manifest_sha}  manifest.json\n".encode(),
                ),
                (
                    "file",
                    "proxywar-runpod-bundle/bin/launcher",
                    b"#!/bin/sh\n",
                ),
            ],
        )
        destination = self.root / "destination"
        result = extract_archive(
            archive_path,
            destination,
            expected_sha256=sha256_file(archive_path),
        )
        self.assertEqual(result["status"], "extracted")
        self.assertEqual(result["manifest_sha256"], manifest_sha)
        self.assertTrue(
            (
                destination
                / "proxywar-runpod-bundle"
                / "bin"
                / "launcher"
            ).is_file()
        )

    def test_rejects_traversal_and_absolute_paths(self) -> None:
        for name in (
            "proxywar-runpod-bundle/../../escape",
            "/proxywar-runpod-bundle/absolute",
        ):
            with self.subTest(name=name):
                archive_path = self.root / f"bad-{len(name)}.tar.gz"
                create_archive(archive_path, [("file", name, b"x")])
                with self.assertRaises(UnsafeArchiveError):
                    preflight_archive(
                        archive_path,
                        expected_sha256=sha256_file(archive_path),
                    )

    def test_rejects_symlink_escape_and_hardlink(self) -> None:
        cases = [
            (
                "symlink",
                "proxywar-runpod-bundle/link",
                "../../outside",
            ),
            (
                "hardlink",
                "proxywar-runpod-bundle/hard",
                "proxywar-runpod-bundle/manifest.json",
            ),
        ]
        for index, entry in enumerate(cases):
            with self.subTest(kind=entry[0]):
                archive_path = self.root / f"link-{index}.tar.gz"
                create_archive(archive_path, [entry])
                with self.assertRaises(UnsafeArchiveError):
                    preflight_archive(
                        archive_path,
                        expected_sha256=sha256_file(archive_path),
                    )

    def test_rejects_declared_and_compressed_oversize(self) -> None:
        archive_path = self.root / "oversize.tar.gz"
        create_archive(
            archive_path,
            [("file", "proxywar-runpod-bundle/file", b"0123456789")],
        )
        digest = sha256_file(archive_path)
        with self.assertRaisesRegex(UnsafeArchiveError, "declared expanded"):
            preflight_archive(
                archive_path,
                expected_sha256=digest,
                max_expanded_bytes=9,
            )
        with self.assertRaisesRegex(UnsafeArchiveError, "compressed archive size"):
            preflight_archive(
                archive_path,
                expected_sha256=digest,
                max_compressed_bytes=archive_path.stat().st_size - 1,
            )

    def test_rejects_wrong_hash_and_existing_destination(self) -> None:
        archive_path = self.root / "hash.tar.gz"
        create_archive(
            archive_path,
            [("file", "proxywar-runpod-bundle/file", b"x")],
        )
        with self.assertRaisesRegex(UnsafeArchiveError, "SHA-256 mismatch"):
            preflight_archive(
                archive_path,
                expected_sha256="0" * 64,
            )
        destination = self.root / "existing"
        destination.mkdir()
        with self.assertRaisesRegex(UnsafeArchiveError, "new path"):
            extract_archive(
                archive_path,
                destination,
                expected_sha256=sha256_file(archive_path),
            )


if __name__ == "__main__":
    unittest.main()
