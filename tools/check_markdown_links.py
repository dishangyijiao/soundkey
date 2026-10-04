"""Check local Markdown links and heading fragments in the repository."""

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit


LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)
IGNORED_DIRECTORIES = {".git", ".claude", "coverage", "node_modules", "target", ".export-venv"}


def markdown_links(text):
    """Yield local link targets, excluding images and external URLs."""
    for match in LINK.finditer(text):
        target = match.group(1).strip().split(maxsplit=1)[0].strip("<>")
        parsed = urlsplit(target)
        if not parsed.scheme and not target.startswith("//"):
            yield target


def heading_anchors(text):
    """Return GitHub-style anchors for ATX headings, including duplicate suffixes."""
    anchors = set()
    counts = {}
    for match in HEADING.finditer(text):
        heading = re.sub(r"[`*_~]", "", match.group(1)).lower().strip()
        slug = re.sub(r"[^\w -]", "", heading, flags=re.UNICODE)
        slug = re.sub(r"[ -]+", "-", slug).strip("-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        anchors.add(f"{slug}-{count}" if count else slug)
    return anchors


def check_documents(root, documents):
    """Return human-readable errors for missing local files and heading fragments."""
    errors = []
    for document in documents:
        content = document.read_text(encoding="utf-8")
        for target in markdown_links(content):
            parsed = urlsplit(target)
            relative = unquote(parsed.path)
            destination = (document.parent / relative).resolve() if relative else document.resolve()
            try:
                destination.relative_to(root.resolve())
            except ValueError:
                errors.append(f"{document.relative_to(root)}: link escapes repository: {target}")
                continue
            if not destination.exists():
                errors.append(f"{document.relative_to(root)}: missing link target: {target}")
                continue
            if parsed.fragment and destination.is_file() and destination.suffix.lower() == ".md":
                anchors = heading_anchors(destination.read_text(encoding="utf-8"))
                fragment = unquote(parsed.fragment).lower()
                if fragment not in anchors:
                    errors.append(f"{document.relative_to(root)}: missing heading anchor: {target}")
    return errors


def markdown_documents(root):
    """Find project Markdown files while skipping generated and dependency trees."""
    return sorted(
        path
        for path in root.rglob("*.md")
        if not any(part in IGNORED_DIRECTORIES for part in path.relative_to(root).parts)
    )


def main():
    root = Path(__file__).resolve().parents[1]
    documents = markdown_documents(root)
    errors = check_documents(root, documents)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Checked local Markdown links in {len(documents)} files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
