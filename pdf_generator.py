import html
import re


def _convert_inline_markdown_to_html(text: str) -> str:
    escaped = html.escape(text)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)


def _markdown_table_to_html(lines: list[str]) -> str:
    rows = [[cell.strip() for cell in line.strip().strip("|").split("|")] for line in lines]
    if not rows:
        return ""

    header = rows[0]
    separator_index = 1 if len(rows) > 1 and all(set(cell.replace(" ", "")) <= {"-", ":"} for cell in rows[1]) else None
    body_rows = rows[2:] if separator_index is not None else rows[1:]

    header_html = "".join(f"<th>{_convert_inline_markdown_to_html(cell)}</th>" for cell in header)
    body_html = "\n".join(
        "<tr>" + "".join(f"<td>{_convert_inline_markdown_to_html(cell)}</td>" for cell in row) + "</tr>"
        for row in body_rows
    )
    return f"<table><thead><tr>{header_html}</tr></thead><tbody>{body_html}</tbody></table>"


def convert_md_to_html(raw_markdown_text: str) -> str:
    html_parts: list[str] = []
    table_buffer: list[str] = []
    list_buffer: list[str] = []

    def flush_table() -> None:
        nonlocal table_buffer
        if table_buffer:
            html_parts.append(_markdown_table_to_html(table_buffer))
            table_buffer = []

    def flush_list() -> None:
        nonlocal list_buffer
        if list_buffer:
            items = "".join(f"<li>{_convert_inline_markdown_to_html(item)}</li>" for item in list_buffer)
            html_parts.append(f"<ul>{items}</ul>")
            list_buffer = []

    for raw_line in raw_markdown_text.splitlines():
        line = raw_line.strip()

        if not line:
            flush_table()
            flush_list()
            continue

        if line.startswith("|") and line.endswith("|"):
            flush_list()
            table_buffer.append(line)
            continue

        flush_table()

        if line.startswith(("- ", "* ")):
            list_buffer.append(line[2:].strip())
            continue

        flush_list()

        if line.startswith("## "):
            html_parts.append(f"<h2>{_convert_inline_markdown_to_html(line[3:].strip())}</h2>")
        elif line.startswith("# "):
            html_parts.append(f"<h1>{_convert_inline_markdown_to_html(line[2:].strip())}</h1>")
        elif re.match(r"^\d+\.\s+", line):
            html_parts.append(f"<p class=\"roadmap\"><strong>{_convert_inline_markdown_to_html(line)}</strong></p>")
        else:
            html_parts.append(f"<p>{_convert_inline_markdown_to_html(line)}</p>")

    flush_table()
    flush_list()
    return "\n".join(html_parts)


def _build_html_document(raw_markdown_text: str) -> str:
    content_body_html = convert_md_to_html(raw_markdown_text)
    return f"""<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <style>
        @page {{ size: A4; margin: 20mm 15mm; }}
        body {{ font-family: Arial, DejaVu Sans, sans-serif; color: #2d3748; line-height: 1.5; font-size: 10pt; }}
        h1 {{ color: #1a202c; font-size: 16pt; margin: 0 0 12px; }}
        h2 {{ color: #1a202c; border-left: 4px solid #3182ce; padding-left: 8px; margin-top: 20px; font-size: 13pt; }}
        p {{ margin: 8px 0; }}
        strong {{ color: #1a202c; font-weight: 700; }}
        ul {{ margin: 8px 0 12px 18px; padding: 0; }}
        li {{ margin: 4px 0; }}
        table {{ width: 100%; border-collapse: collapse; margin: 15px 0; }}
        th {{ background-color: #2d3748; color: white; padding: 8px; text-align: left; font-size: 9pt; }}
        td {{ border: 1px solid #e2e8f0; padding: 8px; font-size: 9pt; vertical-align: top; }}
        tr:nth-child(even) {{ background-color: #f7fafc; }}
        .cover {{ background-color: #1a202c; color: white; padding: 15px; margin-bottom: 20px; }}
        .cover h1 {{ color: white; margin: 0; font-size: 16pt; }}
        .roadmap {{ background: #f7fafc; border-left: 3px solid #3182ce; padding: 8px 10px; }}
    </style>
</head>
<body>
    <div class="cover">
        <h1>Taktiksel Analiz ve Regülasyon Raporu</h1>
    </div>
    {content_body_html}
</body>
</html>"""


def generate_tactical_pdf(raw_markdown_text: str, output_path: str) -> None:
    from weasyprint import HTML

    html_content = _build_html_document(raw_markdown_text)
    HTML(string=html_content, encoding="utf-8").write_pdf(output_path)
