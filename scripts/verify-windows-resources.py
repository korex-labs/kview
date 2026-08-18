#!/usr/bin/env python3
"""Verify that a PE executable contains the expected application resources."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

EXPECTED_RESOURCE_TYPES = {
    3: "RT_ICON",
    14: "RT_GROUP_ICON",
    24: "RT_MANIFEST",
}


def unpack_from(data: bytes, fmt: str, offset: int) -> tuple[int, ...]:
    size = struct.calcsize(fmt)
    if offset < 0 or offset + size > len(data):
        raise ValueError(f"truncated PE data at offset {offset}")
    return struct.unpack_from(fmt, data, offset)


def resource_type_ids(data: bytes) -> set[int]:
    if data[:2] != b"MZ":
        raise ValueError("missing DOS MZ header")

    (pe_offset,) = unpack_from(data, "<I", 0x3C)
    if data[pe_offset : pe_offset + 4] != b"PE\0\0":
        raise ValueError("missing PE signature")

    coff_offset = pe_offset + 4
    _, section_count, _, _, _, optional_size, _ = unpack_from(data, "<HHIIIHH", coff_offset)
    optional_offset = coff_offset + 20
    (magic,) = unpack_from(data, "<H", optional_offset)
    if magic == 0x20B:  # PE32+
        data_directory_offset = optional_offset + 112
    elif magic == 0x10B:  # PE32
        data_directory_offset = optional_offset + 96
    else:
        raise ValueError(f"unsupported PE optional-header magic 0x{magic:x}")

    resource_directory_entry = data_directory_offset + (2 * 8)
    resource_rva, resource_size = unpack_from(data, "<II", resource_directory_entry)
    if resource_rva == 0 or resource_size == 0:
        raise ValueError("PE resource directory is absent")

    section_offset = optional_offset + optional_size
    resource_file_offset = None
    for index in range(section_count):
        entry_offset = section_offset + (index * 40)
        virtual_size, virtual_address, raw_size, raw_offset = unpack_from(
            data, "<IIII", entry_offset + 8
        )
        section_span = max(virtual_size, raw_size)
        if virtual_address <= resource_rva < virtual_address + section_span:
            resource_file_offset = raw_offset + (resource_rva - virtual_address)
            break
    if resource_file_offset is None:
        raise ValueError("PE resource RVA does not map to a section")

    _, _, _, _, named_count, id_count = unpack_from(
        data, "<IIHHHH", resource_file_offset
    )
    ids: set[int] = set()
    entries_offset = resource_file_offset + 16
    for index in range(named_count + id_count):
        name_or_id, _ = unpack_from(data, "<II", entries_offset + (index * 8))
        if name_or_id & 0x80000000 == 0:
            ids.add(name_or_id & 0xFFFF)
    return ids


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(sys.argv[0]).name} <windows-executable>", file=sys.stderr)
        return 2

    executable = Path(sys.argv[1])
    try:
        ids = resource_type_ids(executable.read_bytes())
    except (OSError, ValueError, struct.error) as error:
        print(f"failed to inspect {executable}: {error}", file=sys.stderr)
        return 1

    missing = {
        resource_id: name
        for resource_id, name in EXPECTED_RESOURCE_TYPES.items()
        if resource_id not in ids
    }
    if missing:
        expected = ", ".join(f"{name} ({resource_id})" for resource_id, name in missing.items())
        print(f"{executable} is missing resources: {expected}", file=sys.stderr)
        return 1

    found = ", ".join(
        f"{name} ({resource_id})" for resource_id, name in EXPECTED_RESOURCE_TYPES.items()
    )
    print(f"Windows resources OK: {found}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
