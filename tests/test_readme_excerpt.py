"""The README kept for the report's README section: the top of the file, cut
at a blank line and never inside a code block."""

from __future__ import annotations

from holt.about import MAX_README, readme_excerpt


def test_a_short_readme_is_kept_whole_without_comments():
    text = "<!-- badges -->\n# Flask\n\nFlask is a micro framework.\n\n## Install\n\npip install flask\n"
    assert readme_excerpt(text) == "# Flask\n\nFlask is a micro framework.\n\n## Install\n\npip install flask"


def test_nothing_to_show_is_none():
    assert readme_excerpt(None) is None
    assert readme_excerpt("") is None
    assert readme_excerpt("  \n\n ") is None
    assert readme_excerpt("<!-- only a comment -->") is None


def test_a_long_readme_is_cut_at_a_blank_line():
    paragraph = "word " * 100 + "\n\n"
    out = readme_excerpt(paragraph * 40)
    assert out is not None and len(out) <= MAX_README
    assert out.endswith("word")  # a whole paragraph, not a cut word
    assert not out.endswith("\n")


def test_a_cut_never_leaves_a_code_block_open():
    head = "intro " * 600 + "\n\n"
    fenced = "```\n" + "code line\n" * 400 + "```\n\n"
    out = readme_excerpt(head + fenced + "tail\n")
    assert out is not None and len(out) <= MAX_README
    assert out.count("```") % 2 == 0
    assert "code line" not in out


def test_windows_line_endings_are_normalised():
    assert readme_excerpt("# A\r\n\r\ntext\r\n") == "# A\n\ntext"


def test_a_symlinked_readme_is_its_target_path_and_counts_as_none():
    assert readme_excerpt("packages/next/README.md") is None
    assert readme_excerpt("docs/README.md\n") is None
    assert readme_excerpt("One line of real words.") == "One line of real words."
