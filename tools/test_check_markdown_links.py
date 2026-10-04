import tempfile
import unittest
from pathlib import Path

from tools.check_markdown_links import check_documents, heading_anchors, markdown_documents, markdown_links


class MarkdownLinkCheckTests(unittest.TestCase):
    def test_finds_inline_links_and_ignores_images_and_external_links(self):
        self.assertEqual(
            list(markdown_links("[guide](guide.md) ![diagram](image.png) [site](https://example.com)")),
            ["guide.md"],
        )

    def test_heading_anchors_normalize_text_and_disambiguate_repeats(self):
        self.assertEqual(
            heading_anchors("# Score: details\n## Score: details\n## 中文 术语"),
            {"score-details", "score-details-1", "中文-术语"},
        )

    def test_reports_missing_paths_and_missing_anchors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "README.md").write_text("[missing](nope.md) [anchor](guide.md#absent)\n")
            (root / "guide.md").write_text("# Present\n")
            errors = check_documents(root, [root / "README.md", root / "guide.md"])
        self.assertEqual(len(errors), 2)
        self.assertIn("nope.md", errors[0])
        self.assertIn("#absent", errors[1])

    def test_accepts_existing_relative_paths_and_case_insensitive_heading_anchors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "README.md").write_text("[section](guide.md#hello-world)\n")
            (root / "guide.md").write_text("# Hello World\n")
            self.assertEqual(check_documents(root, [root / "README.md", root / "guide.md"]), [])

    def test_document_discovery_skips_dependency_and_generated_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "node_modules" / "dependency").mkdir(parents=True)
            (root / "coverage").mkdir()
            for relative in ("docs/guide.md", "node_modules/dependency/README.md", "coverage/report.md"):
                (root / relative).write_text("# Document\n")
            self.assertEqual([p.relative_to(root).as_posix() for p in markdown_documents(root)], ["docs/guide.md"])


if __name__ == "__main__":
    unittest.main()
