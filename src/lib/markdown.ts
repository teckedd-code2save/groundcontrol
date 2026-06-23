export function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const blocks: string[] = [];
  let text = md.replace(/```(?:[a-zA-Z0-9]*)\n?([\s\S]*?)```/g, (_m, code) => {
    blocks.push(
      `<pre class="my-3 overflow-x-auto rounded-lg bg-black/40 border border-border p-3 text-xs font-mono text-foreground"><code>${esc(
        code.replace(/\n$/, "")
      )}</code></pre>`
    );
    return `\x00BLOCK${blocks.length - 1}\x00`;
  });

  text = esc(text);
  text = text.replace(/`([^`]+)`/g, '<code class="rounded bg-border/50 px-1 py-0.5 text-xs font-mono">$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/^###\s+(.*)$/gm, '<h3 class="font-semibold text-base mt-4 mb-2">$1</h3>');
  text = text.replace(/^##\s+(.*)$/gm, '<h2 class="font-semibold text-lg mt-5 mb-2">$1</h2>');
  text = text.replace(/^#\s+(.*)$/gm, '<h1 class="font-bold text-xl mt-6 mb-3">$1</h1>');
  text = text.replace(/^\s*[-*]\s+(.*)$/gm, "<li>$1</li>");
  text = text.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul class="list-disc pl-5 my-2 space-y-1">$1</ul>');
  text = text.replace(/\n{2,}/g, "<br/><br/>").replace(/\n/g, "<br/>");
  text = text.replace(/\x00BLOCK(\d+)\x00/g, (_m, i) => blocks[Number(i)]);
  return text;
}
